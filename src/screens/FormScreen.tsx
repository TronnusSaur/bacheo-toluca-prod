import React, { useState, useRef, useEffect } from 'react'
import { Camera, MapPin, Search, ChevronRight, LayoutDashboard, CheckCircle, WifiOff, UserCheck, Phone, Loader } from 'lucide-react'
import { saveReportJSON, saveReportPhoto, addPendingItem, getPendingItems, clearReportFiles } from '../lib/robustStore'
import { apiFetch } from '../lib/apiFetch'
import { supabase } from '../lib/supabase'
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
  const [autoFolio, setAutoFolio] = useState<string>('')
  const [lastSubmittedFolio, setLastSubmittedFolio] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // OPTIMIZATION: Pre-compressed photo buffer, ready to submit instantly
  const compressedPhotoRef = useRef<ArrayBuffer | null>(null)
  const compressedBlobRef = useRef<Blob | null>(null)

  const getContractPrefix = (contractId: string) => {
    const num = (contractId.match(/\d+/)?.[0] || '0').slice(-2).padStart(2, '0');
    return num;
  }

  const calculateNextFolio = async (contractId: string) => {
    if (!contractId) {
      setAutoFolio('')
      return
    }
    const prefix = getContractPrefix(contractId)
    
    // 1. Consultar en vivo al servidor (fuente de la verdad: Google Sheets + Cache)
    try {
      const res = await apiFetch(`/api/reports/next-folio?contractId=${encodeURIComponent(contractId)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.nextFolio) {
          setAutoFolio(data.nextFolio)
          return
        }
      }
    } catch (_) {}

    // 2. Fallback offline: Caché local + cola de pendientes
    let allReports: any[] = []
    try {
      const { value } = await Preferences.get({ key: 'cached_reports_list' })
      if (value) allReports = JSON.parse(value)
    } catch (_) {}

    const pendingKeys = await getPendingItems()
    const offlineFolios = pendingKeys.map(k => k.split('_')[0])

    let maxSeq = 0
    const checkFolio = (f: string) => {
      const clean = String(f || '').trim().replace(/^'/, '')
      const padded = /^\d{1,5}$/.test(clean) ? clean.padStart(6, '0') : clean
      if (padded.startsWith(prefix) && padded.length === 6) {
        const seq = parseInt(padded.slice(2), 10)
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq
      }
    }

    allReports.forEach(r => checkFolio(r.folio))
    offlineFolios.forEach(f => checkFolio(f))

    const nextSeq = maxSeq + 1
    const nextFolio = `${prefix}${nextSeq.toString().padStart(4, '0')}`
    setAutoFolio(nextFolio)
  }

  const updateOfflineCount = async () => {
    const list = await getPendingItems()
    setOfflineCount(list.length)
    console.log('[DEBUG] Reportes offline:', list.length)
  }

  useEffect(() => {
    // ─── AUTO-GEOLOCALIZACIÓN AL ABRIR LA PANTALLA (patrón LEVANTAMIENTO) ─────
    // enableHighAccuracy: false = usa WiFi/celular (<1s), maximumAge: 60000 = reutiliza la última posición de 60s
    const initLocation = () => {
      if (!navigator.geolocation) return
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords
          setFormData(prev => ({ ...prev, lat: latitude, lng: longitude }))
          try {
            const response = await apiFetch('/api/radar', {
              method: 'POST',
              body: JSON.stringify({ lat: latitude, lng: longitude })
            })
            const data = await response.json()
            if (response.ok) {
              setFormData(prev => ({
                ...prev,
                delegacion: data.delegacion || prev.delegacion,
                colonia: data.name || prev.colonia,
                lat: latitude,
                lng: longitude
              }))
            }
          } catch (radarErr) {
            console.warn('[RADAR] Error al obtener zona:', radarErr)
          }
        },
        (err) => console.warn('[GEO INIT] Error al pre-cargar ubicación:', err.message),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      )
    }

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
          calculateNextFolio(first.id);
        }
      })
      .catch((err) => {
        console.error('[CONTRATOS ERROR] No se pudieron cargar:', err);
      })
    updateOfflineCount()
    initLocation()
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
      if (contract) {
        if (formData.delegacion === '---' || formData.delegacion === '') {
          updatedData.delegacion = contract.delegacion
        }
        calculateNextFolio(contract.id)
      } else {
        setAutoFolio('')
      }
    }

    setFormData(updatedData)
  }

  // Botón manual de re-geolocalización (alta precisión GPS cuando el usuario lo pide explicitamente)
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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
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

  const updateLocalCachedReport = async (reportObj: any) => {
    try {
      const { value } = await Preferences.get({ key: 'cached_reports_list' });
      let list: any[] = [];
      if (value) {
        try { list = JSON.parse(value); } catch (_) {}
      }
      const normFolio = (f: string) => String(f || '').trim().replace(/^'/, '').padStart(6, '0');
      list = [reportObj, ...list.filter(r => normFolio(r.folio) !== normFolio(reportObj.folio))];
      await Preferences.set({ key: 'cached_reports_list', value: JSON.stringify(list) });
      
      // Reactive event to render in LogScreen in 0ms
      window.dispatchEvent(new CustomEvent('report-saved', { detail: reportObj }));
    } catch (e) {
      console.warn('[CACHE UPDATE ERROR]', e);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasPhoto || !selectedContract) return
    
    setIsUploading(true)
    setUploadStage('compressing')
    
    const prefix = getContractPrefix(selectedContract.id);
    const folio = autoFolio || `${prefix}0001`;
    setLastSubmittedFolio(folio);

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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await apiFetch('/api/reports', {
        method: 'POST',
        body: submission,
        signal: controller.signal,
      })

      clearTimeout(timeoutId);

      if (response.ok) {
        let resJson: any = null;
        try { resJson = await response.json(); } catch (_) {}
        const serverAssignedFolio = resJson?.folio || folio;
        setLastSubmittedFolio(serverAssignedFolio);

        const newReportObj = {
          id: Date.now(),
          folio: serverAssignedFolio,
          contractId: selectedContract.id,
          contractid: selectedContract.id,
          empresaName: selectedContract.empresa,
          empresaname: selectedContract.empresa,
          lat: formData.lat,
          lng: formData.lng,
          locationDesc: formData.locationDesc,
          locationdesc: formData.locationDesc,
          delegacion: formData.delegacion,
          colonia: formData.colonia,
          tipoBache: formData.tipoBache || 'SUPERFICIAL',
          tipobache: formData.tipoBache || 'SUPERFICIAL',
          calle_1: formData.calle1,
          calle1: formData.calle1,
          calle_2: formData.calle2,
          calle2: formData.calle2,
          largo: 0,
          ancho: 0,
          profundidad: 0,
          m2: 0,
          status: 'DETECTADO',
          photoUrl: resJson?.photoUrl || '',
          photourl: resJson?.photoUrl || '',
          photoCaja: '',
          photocaja: '',
          photoFinal: '',
          photofinal: '',
          created_by: userProfile?.email || 'admin@bacheo.gob.mx',
          updated_by: userProfile?.email || 'admin@bacheo.gob.mx',
          created_at: new Date().toISOString(),
          isOffline: false
        };

        // 0ms instant local cache injection
        await updateLocalCachedReport(newReportObj);
        
        // Direct local Supabase upsert from client on local network (0-50ms)
        try {
          await supabase.from('bacheo_pruebas_app').upsert([{
            folio: serverAssignedFolio,
            contractId: selectedContract.id,
            empresaName: selectedContract.empresa,
            lat: formData.lat,
            lng: formData.lng,
            locationDesc: formData.locationDesc,
            delegacion: formData.delegacion,
            colonia: formData.colonia,
            tipoBache: formData.tipoBache || 'SUPERFICIAL',
            calle_1: formData.calle1,
            calle_2: formData.calle2,
            status: 'DETECTADO',
            photoUrl: resJson?.photoUrl || '',
            created_by: userProfile?.email || 'admin@bacheo.gob.mx',
            updated_by: userProfile?.email || 'admin@bacheo.gob.mx',
          }], { onConflict: 'folio' });
          console.log('[SUPABASE LOCAL] ✅ Folio guardado en bacheo_pruebas_app:', serverAssignedFolio);
        } catch (supaErr: any) {
          console.warn('[SUPABASE LOCAL] Nota:', supaErr?.message);
        }

        await clearReportFiles(serverAssignedFolio, 'inicial');
        updateOfflineCount();
        setUploadStage('done');
        setShowSuccessModal(true);
        resetForm();
        if (selectedContract) calculateNextFolio(selectedContract.id);
      } else {
        setUploadStage('saving-offline');
        await saveToOffline(folio);
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
      setLastSubmittedFolio(folio);
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

      const offlineReportObj = {
        id: Date.now(),
        folio,
        contractId: formData.contractId,
        contractid: formData.contractId,
        empresaName: selectedContract?.empresa || '',
        empresaname: selectedContract?.empresa || '',
        lat: formData.lat,
        lng: formData.lng,
        locationDesc: formData.locationDesc,
        locationdesc: formData.locationDesc,
        delegacion: formData.delegacion,
        colonia: formData.colonia,
        tipoBache: formData.tipoBache || 'SUPERFICIAL',
        tipobache: formData.tipoBache || 'SUPERFICIAL',
        calle_1: formData.calle1,
        calle1: formData.calle1,
        calle_2: formData.calle2,
        calle2: formData.calle2,
        largo: 0,
        ancho: 0,
        profundidad: 0,
        m2: 0,
        status: 'DETECTADO',
        photoUrl: '',
        photourl: '',
        photoCaja: '',
        photocaja: '',
        photoFinal: '',
        photofinal: '',
        created_by: userProfile?.email || 'admin@bacheo.gob.mx',
        updated_by: userProfile?.email || 'admin@bacheo.gob.mx',
        created_at: new Date().toISOString(),
        isOffline: true
      };

      await updateLocalCachedReport(offlineReportObj);
      
      console.log('[OFFLINE] Reporte e imagen guardados localmente ok.');
      setShowSuccessModal(true);
      resetForm();
      if (selectedContract) calculateNextFolio(selectedContract.id);
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
          folio={lastSubmittedFolio}
          subtitle={offlineCount > 0 ? "Guardado localmente para sincronización" : "Reporte de apertura registrado correctamente"}
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
            <label className="field-label">Folio Consecutivo del Bache</label>
            <div className="auto-folio-box">
              <div className="auto-folio-content">
                <span className="auto-folio-label">Folio</span>
                <span className="auto-folio-number">{autoFolio || `${getContractPrefix(selectedContract.id)}0001`}</span>
              </div>
              <span className="auto-folio-tag">Automático</span>
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
            disabled={isUploading || !hasPhoto || !formData.lat || !selectedContract}
            style={{ 
              opacity: (hasPhoto && formData.lat && selectedContract) ? 1 : 0.5,
              cursor: (hasPhoto && formData.lat && selectedContract) ? 'pointer' : 'not-allowed'
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
