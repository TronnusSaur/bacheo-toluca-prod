import React, { useState, useRef, useEffect } from 'react'
import { Camera, MapPin, Search, ChevronRight, LayoutDashboard, CheckCircle, WifiOff, UserCheck, Phone, Loader } from 'lucide-react'
import { saveReportJSON, saveReportPhoto, addPendingItem, getPendingItems } from '../lib/robustStore'
import { apiFetch } from '../lib/apiFetch'
import { compressImage } from '../lib/imageUtils'
import SuccessModal from '../components/SuccessModal'
import './FormScreen.css'

interface Contract {
  id: string;
  id_real: string;
  empresa: string;
  supervisor: string;
  supervisor_tel: string;
  residente: string;
  residente_tel: string;
  delegacion: string;
}

type UploadStage = 'idle' | 'compressing' | 'sending' | 'saving-offline' | 'done';

export default function FormScreen({ userProfile }: { userProfile: any }) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  const [formData, setFormData] = useState({
    contractId: '',
    locationDesc: '',
    calle1: '',
    calle2: '',
    delegacion: '---',
    colonia: '---',
    lat: 0,
    lng: 0,
    tipoBache: ''  // H-5: determined only during caja phase with measurements
  })
  
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStage, setUploadStage] = useState<UploadStage>('idle')
  const [offlineCount, setOfflineCount] = useState(0)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [hasPhoto, setHasPhoto] = useState(false)
  const [folioSuffix, setFolioSuffix] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // OPTIMIZATION: Pre-compressed photo buffer, ready to submit instantly
  const compressedPhotoRef = useRef<ArrayBuffer | null>(null)
  const compressedBlobRef = useRef<Blob | null>(null)

  const getContractPrefix = (contractId: string) => {
    const num = (contractId.match(/\d+/)?.[0] || '0').slice(-2).padStart(2, '0');
    return num;
  }

  const updateOfflineCount = async () => {
    const list = await getPendingItems()
    setOfflineCount(list.length)
    console.log('[DEBUG] Reportes offline:', list.length)
  }

  useEffect(() => {
    apiFetch('/api/catalogs/contracts')
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setContracts(list);
        // Auto-select if only 1 contract (Resident tier)
        if (list.length === 1) {
          const first = list[0];
          setSelectedContract(first);
          setFormData(prev => ({ 
            ...prev, 
            contractId: first.id,
            delegacion: first.delegacion
          }));
        }
      })
      .catch((err) => {
        console.error('[CONTRATOS ERROR] No se pudieron cargar:', err);
      })
    updateOfflineCount()
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    let { name, value } = e.target
    if (['locationDesc', 'calle1', 'calle2'].includes(name)) {
      value = value.toUpperCase()
    }

    const updatedData = { ...formData, [name]: value }
    
    if (name === 'contractId') {
      const contract = contracts.find(c => c.id === value)
      setSelectedContract(contract || null)
      if (contract && (formData.delegacion === '---' || formData.delegacion === '')) {
        updatedData.delegacion = contract.delegacion
      }
    }

    setFormData(updatedData)
  }

  const requestLocation = () => {
    if (!navigator.geolocation) return
    setIsUploading(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        try {
          const response = await apiFetch('/api/radar', {
            method: 'POST',
            body: JSON.stringify({ lat: latitude, lng: longitude })
          })
          const data = await response.json()
          if (response.ok) {
            setFormData(prev => ({
              ...prev,
              delegacion: data.delegacion,
              colonia: data.name,
              lat: latitude,
              lng: longitude
            }))
          }
        } catch (err) {
          console.error('Radar error', err)
        } finally {
          setIsUploading(false)
        }
      },
      () => setIsUploading(false),
      { enableHighAccuracy: true }
    )
  }

  /**
   * OPTIMIZATION: Compress the photo immediately when the user selects it (onChange),
   * NOT when they press "Guardar". This eliminates 1–3 seconds of delay at submit time.
   */
  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      setHasPhoto(false)
      compressedPhotoRef.current = null
      compressedBlobRef.current = null
      return
    }

    setHasPhoto(true)
    
    // Compress in background while user fills out the rest of the form
    try {
      const compressed = await compressImage(file)
      compressedBlobRef.current = compressed
      compressedPhotoRef.current = await compressed.arrayBuffer()
      console.log('[COMPRESS] Foto pre-comprimida OK:', compressedPhotoRef.current.byteLength, 'bytes')
    } catch (compressErr) {
      console.warn('[COMPRESS] Falló la compresión. Usando buffer crudo como fallback:', compressErr)
      try {
        compressedBlobRef.current = file
        compressedPhotoRef.current = await file.arrayBuffer()
        console.log('[COMPRESS] Buffer crudo rescatado:', compressedPhotoRef.current.byteLength, 'bytes')
      } catch (rawErr) {
        console.error('[COMPRESS] No se pudo leer ni el buffer crudo:', rawErr)
        compressedPhotoRef.current = null
        compressedBlobRef.current = null
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasPhoto || !selectedContract) return
    
    setIsUploading(true)
    setUploadStage('compressing')
    
    const prefix = getContractPrefix(selectedContract.id);
    const folio = `${prefix}${folioSuffix}`;

    // Photo buffer is ALREADY compressed since onChange — zero delay here
    const photoBuffer = compressedPhotoRef.current;

    // Move to "sending" stage immediately (compression was already done)
    setUploadStage('sending')

    const submission = new FormData();
    submission.append('folio', folio);
    submission.append('contractId', selectedContract.id);
    submission.append('empresaName', selectedContract.empresa);
    submission.append('phase', 'inicial');
    submission.append('lat', formData.lat.toString());
    submission.append('lng', formData.lng.toString());
    submission.append('locationDesc', formData.locationDesc);
    submission.append('calle1', formData.calle1);
    submission.append('calle2', formData.calle2);
    submission.append('delegacion', formData.delegacion);
    submission.append('colonia', formData.colonia);
    if (formData.tipoBache) {
      submission.append('tipoBache', formData.tipoBache);
    }

    // Attach the pre-compressed buffer
    if (photoBuffer) {
      submission.append('photo', new Blob([photoBuffer], { type: 'image/jpeg' }), 'inicial.jpg');
    }

    try {
      // OPTIMIZATION: 25-second timeout to prevent indefinite hangs.
      // If the server doesn't respond in time, save offline automatically.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await apiFetch('/api/reports', {
        method: 'POST',
        body: submission,
        signal: controller.signal,
      })

      clearTimeout(timeoutId);

      if (response.ok) {
        setUploadStage('done')
        setShowSuccessModal(true)
        resetForm()
      } else {
        setUploadStage('saving-offline')
        await saveToOffline(folio)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.warn('[TIMEOUT] El servidor no respondió en 25s. Guardando offline...');
      }
      setUploadStage('saving-offline')
      await saveToOffline(folio)
    } finally {
      setIsUploading(false)
      setUploadStage('idle')
    }
  }

  const saveToOffline = async (folio: string) => {
    try {
      // 1. Guardar la info como archivo JSON de metadatos
      await saveReportJSON(folio, 'inicial', {
        type: 'APERTURA',
        phase: 'inicial',
        fields: {
          folio,
          contractId: formData.contractId,
          empresaName: selectedContract?.empresa || '',
          lat: formData.lat,
          lng: formData.lng,
          largo: '0', ancho: '0', profundidad: '0', m2: '0',
          locationDesc: formData.locationDesc,
          calle1: formData.calle1,
          calle2: formData.calle2,
          delegacion: formData.delegacion,
          colonia: formData.colonia,
          tipoBache: formData.tipoBache
        },
        savedAt: new Date().toISOString()
      });

      // 2. Guardar la foto físicamente si existe
      if (compressedBlobRef.current) {
        await saveReportPhoto(folio, 'inicial', compressedBlobRef.current);
      }

      // 3. Registrar el folio en la cola multiplataforma
      await addPendingItem(`${folio}_inicial`);
      
      console.log('[OFFLINE] Reporte e imagen guardados localmente ok.');
      setShowSuccessModal(true);
      resetForm();
      updateOfflineCount();
    } catch (e) {
      console.error('[OFFLINE ERROR] No se pudo guardar ni localmente:', e);
      alert('Error crítico: no se pudo guardar el reporte. Revise espacio en disco.');
    }
  }

  const resetForm = () => {
    setHasPhoto(false)
    compressedPhotoRef.current = null
    compressedBlobRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFormData(prev => ({ 
      ...prev, 
      locationDesc: '', 
      calle1: '', 
      calle2: '',
      delegacion: '---',
      colonia: '---',
      lat: 0,
      lng: 0 
    }))
    setFolioSuffix('')
  }

  /** Human-readable stage labels for the progress indicator */
  const getStageLabel = (): string => {
    switch (uploadStage) {
      case 'compressing': return '📸 Preparando imagen...';
      case 'sending': return '📡 Enviando al servidor...';
      case 'saving-offline': return '💾 Guardando localmente...';
      case 'done': return '✅ ¡Reporte guardado!';
      default: return 'GUARDAR REPORTE';
    }
  }

  return (
    <div className="form-container animate-in">
      <div className="form-header">
        <div className="form-header-row">
          <h1 className="text-2xl font-black">Apertura Técnica</h1>
          <button type="button" onClick={requestLocation} className="btn-radar">
             <MapPin size={16} /> {isUploading && uploadStage === 'idle' ? '...' : 'OBTENER UBICACIÓN'}
          </button>
        </div>
        <p className="test-badge inline-block mb-4">⚠️ DATOS REALES (CATÁLOGO)</p>
      </div>

      {showSuccessModal && (
        <SuccessModal 
          onClose={() => setShowSuccessModal(false)} 
          subtitle={offlineCount > 0 ? "Guardado localmente para sincronización" : "Reporte de apertura guardado correctamente"}
        />
      )}

      <form onSubmit={handleSubmit}>
        <div className="readonly-grid">
          <div className="readonly-box">
            <span className="field-label">Delegación</span>
            <div className="field-value">{formData.delegacion}</div>
          </div>
          <div className="readonly-box">
            <span className="field-label">UT / Colonia</span>
            <div className="field-value">{formData.colonia}</div>
          </div>
        </div>

        <div className="input-group">
          <label className="field-label">ID Contrato Técnico*</label>
          <select 
            name="contractId"
            className="input-main"
            value={formData.contractId}
            onChange={handleInputChange}
            required
          >
            <option value="">Seleccionar Contrato...</option>
            {contracts.map(c => (
               <option key={c.id} value={c.id}>{c.id} - {c.delegacion}</option>
            ))}
          </select>
        </div>

        {selectedContract && (
          <div className="input-group">
            <label className="field-label">Folio del Bache ({getContractPrefix(selectedContract.id)}XXXX)*</label>
            <div className="folio-input-row">
              <span className="folio-prefix">{getContractPrefix(selectedContract.id)}</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                className="folio-suffix-input"
                placeholder="0001"
                value={folioSuffix}
                onChange={e => setFolioSuffix(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required
              />
            </div>
          </div>
        )}

        {selectedContract && (
          <div className="readonly-box" style={{ marginBottom: '1.5rem', backgroundColor: '#ecfeff', border: '1px solid #cffafe' }}>
             <span className="field-label" style={{ color: '#0891b2' }}>
                <UserCheck size={12} style={{ marginRight: '4px' }} /> Ficha de Supervisión - {selectedContract.empresa}
             </span>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                <div>
                   <p className="text-[9px] font-black text-slate-400 uppercase">Supervisor</p>
                   <p className="field-value" style={{ fontSize: '0.65rem' }}>{selectedContract.supervisor}</p>
                </div>
                <div>
                   <p className="text-[9px] font-black text-slate-400 uppercase">Residente</p>
                   <p className="field-value" style={{ fontSize: '0.65rem' }}>{selectedContract.residente}</p>
                </div>
             </div>
          </div>
        )}

        <div className="input-group">
          <label className="field-label">Calle del Bache* (MAYÚSCULAS)</label>
          <input 
            name="locationDesc"
            className="input-main"
            placeholder="NOMBRE DE LA CALLE..."
            value={formData.locationDesc}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="input-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
          <div className="input-group">
            <label className="field-label">Entre Calle 1*</label>
            <input 
              name="calle1"
              className="input-main"
              placeholder="CALLE 1..."
              value={formData.calle1}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="input-group">
            <label className="field-label">Entre Calle 2*</label>
            <input 
              name="calle2"
              className="input-main"
              placeholder="CALLE 2..."
              value={formData.calle2}
              onChange={handleInputChange}
              required
            />
          </div>
        </div>

        <div className="form-footer" style={{ marginTop: '2rem' }}>
          <label className={`btn-photo ${hasPhoto ? 'btn-photo-success' : ''}`}>
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/*" 
              capture="environment" 
              style={{ display: 'none' }} 
              onChange={handlePhotoChange}
            />
            <Camera size={20} />
            {hasPhoto ? 'FOTO LISTA ✓' : 'TOMAR FOTO INICIAL*'}
          </label>

          <button 
            type="submit" 
            className="btn-submit" 
            disabled={isUploading || !hasPhoto || !formData.lat || !selectedContract || folioSuffix.length !== 4}
            style={{ 
              opacity: (hasPhoto && formData.lat && selectedContract && folioSuffix.length === 4) ? 1 : 0.5,
              cursor: (hasPhoto && formData.lat && selectedContract && folioSuffix.length === 4) ? 'pointer' : 'not-allowed'
            }}
          >
            {isUploading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <Loader size={16} className="spin-icon" />
                {getStageLabel()}
              </span>
            ) : 'GUARDAR REPORTE'}
          </button>
        </div>
      </form>
    </div>
  )
}
