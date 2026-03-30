import { useState, useEffect } from 'react'
import { Calculator, Camera, MapPin, UserCheck, Phone, CheckCircle } from 'lucide-react'
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

export default function FormScreen() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null)
  const [formData, setFormData] = useState({
    contractId: '',
    locationDesc: '',
    largo: '',
    ancho: '',
    profundidad: '',
    m2: 0,
    delegacion: '---',
    colonia: '---',
    lat: 0,
    lng: 0,
    tipoBache: 'SUPERFICIAL'
  })
  const [isLoadingRadar, setIsLoadingRadar] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<string | null>(null)
  const [hasPhoto, setHasPhoto] = useState(false)

  useEffect(() => {
    console.log('[PRUEBA] Buscando contratos...');
    fetch('/api/catalogs/contracts')
      .then(res => res.json())
      .then(data => {
        console.log('[PRUEBA] Contratos cargados:', data.length);
        setContracts(data);
      })
      .catch((err) => {
        console.error('[PRUEBA ERROR] Fallo al cargar contratos:', err);
        setSubmitStatus('[PRUEBA ERROR] No se pudieron cargar los contratos.');
      })
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    const updatedData = { ...formData, [name]: value }
    
    if (name === 'contractId') {
      const contract = contracts.find(c => c.id === value)
      setSelectedContract(contract || null)
      if (contract && formData.delegacion === '---') {
        updatedData.delegacion = contract.delegacion
      }
    }

    if (name === 'largo' || name === 'ancho') {
      const largoVal = parseFloat(name === 'largo' ? value : formData.largo) || 0
      const anchoVal = parseFloat(name === 'ancho' ? value : formData.ancho) || 0
      updatedData.m2 = parseFloat((largoVal * anchoVal).toFixed(2))
    }
    
    if (name === 'profundidad') {
      updatedData.tipoBache = parseFloat(value) > 0.07 ? 'PROFUNDO' : 'SUPERFICIAL'
    }

    setFormData(updatedData)
  }

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setSubmitStatus('[PRUEBA ERROR] GPS no soportado.')
      return
    }

    setIsLoadingRadar(true)
    setSubmitStatus('[PRUEBA] Obteniendo ubicación real...')

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        try {
          const response = await fetch('/api/radar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
            setSubmitStatus('[PRUEBA] Radar: Ubicación detectada en Toluca.')
          } else {
            setSubmitStatus(`[PRUEBA ERROR] ${data.error}`)
          }
        } catch (err) {
          setSubmitStatus('[PRUEBA ERROR] Error de conexión Radar.')
        } finally {
          setIsLoadingRadar(false)
        }
      },
      (error) => {
        setSubmitStatus(`[PRUEBA ERROR] GPS: ${error.message}`)
        setIsLoadingRadar(false)
      },
      { enableHighAccuracy: true }
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedContract) return alert('Selecciona un contrato');
    if (formData.lat === 0) return alert('Esperando ubicación GPS...');

    setSubmitStatus('[PRUEBA] Procesando envío empresarial...');
    
    // Prepare FormData
    const submission = new FormData();
    submission.append('contractId', selectedContract.id);
    submission.append('empresaName', selectedContract.empresa);
    submission.append('phase', 'inicial');
    submission.append('lat', formData.lat.toString());
    submission.append('lng', formData.lng.toString());
    submission.append('largo', formData.largo);
    submission.append('ancho', formData.ancho);
    submission.append('profundidad', formData.profundidad);
    submission.append('m2', formData.m2.toString());
    submission.append('locationDesc', formData.locationDesc);
    submission.append('delegacion', formData.delegacion);
    submission.append('colonia', formData.colonia);
    submission.append('tipoBache', formData.tipoBache);

    // Photo Capture & Compression
    const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (photoInput?.files?.[0]) {
      setSubmitStatus('[PRUEBA] Comprimiendo foto para campo...');
      const compressedBlob = await compressImage(photoInput.files[0]);
      submission.append('photo', compressedBlob, 'upload.jpg');
    }

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        body: submission
      });
      const data = await response.json();
      if (response.ok) {
        setSubmitStatus(`✅ ÉXITO: FOLIO ${data.folio}. Sincronizado.`);
        setHasPhoto(false);
        setFormData({
          contractId: '',
          locationDesc: '',
          largo: '',
          ancho: '',
          profundidad: '',
          m2: 0,
          delegacion: '---',
          colonia: '---',
          lat: 0,
          lng: 0,
          tipoBache: 'SUPERFICIAL'
        });
      } else {
        setSubmitStatus('❌ ERROR AL GUARDAR');
      }
    } catch (err) {
      setSubmitStatus('❌ ERROR DE CONEXIÓN');
    }
  }

  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          let width = img.width;
          let height = img.height;
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => resolve(blob as Blob), 'image/jpeg', 0.6);
        };
      };
    });
  };

  return (
    <div className="form-container animate-in">
      <div className="form-header">
        <div className="form-header-row">
          <div>
            <h2 className="text-2xl font-black">Apertura Técnica</h2>
            <div style={{ marginTop: '0.25rem' }}>
              <span className="test-badge">⚠️ DATOS REALES (CATÁLOGOR)</span>
            </div>
          </div>
          <button onClick={requestLocation} disabled={isLoadingRadar} type="button" className="btn-radar">
            <MapPin size={16} />
            {isLoadingRadar ? 'SINC...' : 'OBTENER UBICACIÓN'}
          </button>
        </div>
      </div>

      {submitStatus && <div className="sim-message">{submitStatus}</div>}

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
            {Array.isArray(contracts) && contracts.map(c => (
               <option key={c.id} value={c.id}>{c.id} - {c.delegacion}</option>
            ))}
          </select>
        </div>

        {selectedContract && (
          <div className="readonly-box" style={{ marginBottom: '1.5rem', backgroundColor: '#ecfeff', border: '1px solid #cffafe' }}>
             <span className="field-label" style={{ color: '#0891b2' }}>
                <UserCheck size={12} style={{ marginRight: '4px' }} /> Ficha de Supervisión - {selectedContract.empresa}
             </span>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                <div>
                   <p className="text-[9px] font-black text-slate-400 uppercase">Supervisor</p>
                   <p className="field-value" style={{ fontSize: '0.65rem' }}>{selectedContract.supervisor}</p>
                   <a href={`tel:${selectedContract.supervisor_tel}`} className="text-cyan-600 flex items-center gap-1 font-bold mt-1" style={{ fontSize: '0.65rem' }}>
                      <Phone size={10} /> {selectedContract.supervisor_tel}
                   </a>
                </div>
                <div>
                   <p className="text-[9px] font-black text-slate-400 uppercase">Residente</p>
                   <p className="field-value" style={{ fontSize: '0.65rem' }}>{selectedContract.residente}</p>
                   <a href={`tel:${selectedContract.residente_tel}`} className="text-cyan-600 flex items-center gap-1 font-bold mt-1" style={{ fontSize: '0.65rem' }}>
                      <Phone size={10} /> {selectedContract.residente_tel}
                   </a>
                </div>
             </div>
             <p className="text-[8px] font-bold text-slate-400 uppercase mt-2">{selectedContract.id_real}</p>
          </div>
        )}

        <div className="input-group">
          <label className="field-label">Referencia de Ubicación*</label>
          <input 
            name="locationDesc"
            className="input-main"
            placeholder="Calle y Número..."
            value={formData.locationDesc}
            onChange={handleInputChange}
            required
          />
        </div>

        <div className="calc-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
             <span className="calc-title" style={{ margin: 0 }}>Dimensiones de Obra</span>
             {formData.profundidad && (
                  <span className={`badge-depth ${parseFloat(formData.profundidad) > 0.07 ? 'deep' : 'shallow'}`}>
                    {parseFloat(formData.profundidad) > 0.07 ? 'PROFUNDO (>0.07m)' : 'SUPERFICIAL (≤0.07m)'}
                  </span>
             )}
          </div>
          
          <div className="calc-grid">
            <div className="calc-item">
              <label>Largo (M)</label>
              <input 
                name="largo"
                type="number"
                step="0.1"
                className="calc-number"
                value={formData.largo}
                onChange={handleInputChange}
                required
              />
            </div>
            <div className="calc-item">
              <label>Ancho (M)</label>
              <input 
                name="ancho"
                type="number"
                step="0.1"
                className="calc-number"
                value={formData.ancho}
                onChange={handleInputChange}
                required
              />
            </div>
            <div className="calc-item">
              <label>Prof. (M)</label>
              <input 
                name="profundidad"
                type="number"
                step="0.01"
                className="calc-number"
                value={formData.profundidad}
                onChange={handleInputChange}
                required
              />
            </div>
          </div>

          <div className="calc-total">
            <span className="total-label">SUPERFICIE CALCULADA</span>
            <div className="total-display">
              <span className="huge-m2">{formData.m2}</span>
              <span className="m2-unit">M²</span>
            </div>
          </div>
        </div>

        <div className="form-footer">
          <label className={`btn-photo ${hasPhoto ? 'btn-photo-success' : ''}`}>
            <input 
              type="file" 
              accept="image/*" 
              capture="environment" 
              style={{ display: 'none' }} 
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setSubmitStatus(`[PRUEBA] Foto capturada: ${e.target.files[0].name}`);
                  setHasPhoto(true);
                }
              }}
            />
            {hasPhoto ? <CheckCircle size={24} className="text-emerald-500" /> : <Camera size={24} />}
            <span>{hasPhoto ? 'FOTO LISTA' : 'TOMAR FOTO'}</span>
          </label>
          <button type="submit" className="btn-submit">
            GUARDAR APERTURA
          </button>
        </div>
      </form>
    </div>
  )
}
