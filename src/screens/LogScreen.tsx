import { useState, useEffect, useRef } from 'react'
import { RefreshCcw, FileText, MapPin, Camera, CheckCircle, ArrowRight, ChevronLeft, WifiOff } from 'lucide-react'
import { savePendingReport } from '../lib/offlineStore'
import './LogScreen.css'

interface Report {
  id: number;
  folio: string;
  contractid?: string;
  contractId?: string;
  locationdesc?: string;
  locationDesc?: string;
  delegacion: string;
  colonia: string;
  status: string;
  created_at: string;
}

export default function LogScreen() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<any[]>([])
  const [selectedContractFilter, setSelectedContractFilter] = useState<string>('ALL')
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [successModal, setSuccessModal] = useState(false)
  const [currentStep, setCurrentStep] = useState<'PHOTO' | 'CONTINUE'>('PHOTO')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchReports = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/reports')
      const data = await response.json()
      // Filter out TERMINADO reports for follow-up board
      setReports(data.filter((r: any) => r.status !== 'TERMINADO'))
    } catch (err) {
      console.error('[SIMULACIÓN ERROR] No se pudieron cargar reportes.')
    } finally {
      setLoading(false)
    }
  }

  const fetchContracts = async () => {
    try {
      const response = await fetch('/api/catalogs/contracts')
      const data = await response.json()
      setContracts(data)
    } catch (err) {
      console.error('[API ERROR] No se pudo cargar el catálogo de contratos.')
    }
  }

  useEffect(() => {
    fetchReports()
    fetchContracts()
  }, [])

  const handlePhotoClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedReport) return

    const phase = selectedReport.status === 'DETECTADO' ? 'caja' : 'terminado'
    setSyncStatus(`COMPRIMIENDO FOTO...`)
    
    try {
      const compressedBlob = await compressImage(file);
      const formData = new FormData()
      formData.append('photo', compressedBlob, 'upload.jpg')
      formData.append('phase', phase)

      const res = await fetch(`/api/reports/${selectedReport.folio}/photo`, {
        method: 'POST',
        body: formData
      })
      if (res.ok) {
        setSyncStatus(`¡CAPTURA EXITOSA!`)
        setCurrentStep('CONTINUE')
        fetchReports()
      } else if (res.status === 409) {
        setSyncStatus(`INFO: ESTE FOLIO YA TIENE ESTA FASE REGISTRADA.`)
        fetchReports() // Re-sincronizar UI
        setCurrentStep('CONTINUE')
      } else {
        const error = await res.json()
        setSyncStatus(`ERROR: ${error.error || 'Fallo servidor'}`)
      }
    } catch (err) {
      // OFFLINE SUPPORT
      try {
        const photoBuffer = await file.arrayBuffer();
        await savePendingReport({
          type: 'UPDATE',
          phase: phase as any,
          fields: {
            folio: selectedReport.folio,
            contractId: selectedReport.contractid || selectedReport.contractId || '',
            empresaName: '', // Not strictly needed for update
            lat: 0, lng: 0, largo: '', ancho: '', profundidad: '', m2: '',
            locationDesc: selectedReport.locationdesc || selectedReport.locationDesc || '',
            delegacion: selectedReport.delegacion,
            colonia: selectedReport.colonia,
            tipoBache: ''
          },
          photoBuffer,
          savedAt: new Date().toISOString()
        });
        setSyncStatus('📵 SIN RED - FOTO GUARDADA LOCALMENTE. SE SUBIRÁ AL RECUPERAR SEÑAL.')
        setCurrentStep('CONTINUE')
      } catch (saveErr) {
        setSyncStatus('FALLO CRÍTICO: NO SE PUDO GUARDAR NI ONLINE NI OFFLINE.')
      }
    }
  }

  const handleContinue = async () => {
    if (!selectedReport) return
    const nextStatus = selectedReport.status === 'DETECTADO' ? 'EN PROCESO' : 'TERMINADO'
    
    setSyncStatus('ACTUALIZANDO...')
    try {
      const res = await fetch(`/api/reports/${selectedReport.folio}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      })
      
      if (res.ok) {
        if (nextStatus === 'TERMINADO') {
          setSuccessModal(true)
          setSelectedReport(null)
          setCurrentStep('PHOTO')
          setSyncStatus(null)
          fetchReports()
        } else {
          const updated = await res.json()
          setSelectedReport(updated)
          setSyncStatus(`ETAPA ACTUALIZADA`)
          setCurrentStep('PHOTO')
          fetchReports()
        }
      } else {
         setSyncStatus('ERROR DEL SERVIDOR')
      }
    } catch (err) {
      setSyncStatus('FALLO DE RED (PATCH)')
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

  if (selectedReport) {
    const isDetected = selectedReport.status === 'DETECTADO'
    const isInProcess = selectedReport.status === 'EN PROCESO'

    return (
      <div className="log-container detail-view">
        <button className="back-btn-nordic" onClick={() => { setSelectedReport(null); setSyncStatus(null); setCurrentStep('PHOTO'); }}>
          <ChevronLeft size={16} /> BITÁCORA
        </button>
        
        <div className="report-card" style={{ cursor: 'default' }}>
          <div className="card-top">
             <div>
                <span className="folio-tag">{selectedReport.folio}</span>
                <p className="subtitle-main" style={{ color: '#94a3b8', fontSize: '0.6rem' }}>{selectedReport.contractid || selectedReport.contractId}</p>
             </div>
             <span className={`status-tag ${isDetected ? 'status-detected' : 'status-process'}`}>
                {selectedReport.status}
             </span>
          </div>

          <div className="card-body">
             <div className="location-snippet" style={{ color: '#1e293b', fontSize: '0.85rem' }}>
                <p>{selectedReport.locationdesc || selectedReport.locationDesc}</p>
             </div>
             <div className="zone-chips">
                <span className="chip">{selectedReport.delegacion}</span>
                <span className="chip">{selectedReport.colonia}</span>
             </div>
          </div>

          <div className="action-module">
             <h3 className="text-sm font-black uppercase tracking-wider mb-6 text-center">
                {currentStep === 'PHOTO' 
                   ? (isDetected ? 'Subir Foto Caja' : 'Subir Foto Final')
                   : 'Confirmar Seguimiento'
                }
             </h3>

             <div className="flex flex-col gap-4">
                {currentStep === 'PHOTO' ? (
                  <button className="action-btn-main btn-upload" onClick={handlePhotoClick}>
                    <Camera size={20} />
                    {isDetected ? 'TOMAR CAJA' : 'TOMAR FINAL'}
                  </button>
                ) : (
                  <button className="action-btn-main btn-next" onClick={handleContinue}>
                    {isInProcess ? 'TERMINAR REPORTE' : 'CONFIRMAR CAJA'}
                    <ArrowRight size={20} />
                  </button>
                )}
                
                {syncStatus && (
                   <div className={`p-4 rounded-2xl text-center text-[8px] font-black uppercase tracking-widest border transition-all ${syncStatus.includes('FALLO') || syncStatus.includes('ERROR') ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'}`}>
                    {syncStatus}
                  </div>
                )}
                
                <input type="file" accept="image/*" capture="environment" hidden ref={fileInputRef} onChange={handleFileChange} />
             </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="log-container">
      <div className="log-header">
        <div>
          <h2 className="title-main">Baches</h2>
          <p className="subtitle-main">Seguimiento Operativo</p>
        </div>
        <button onClick={fetchReports} className="p-2" style={{ background: '#f8fafc', border: 'none', borderRadius: '12px', cursor: 'pointer', color: '#0891b2' }}>
          <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="filter-group mb-6" style={{ background: '#f1f5f9', padding: '12px', borderRadius: '20px', border: '1px solid #e2e8f0' }}>
        <p className="text-[10px] font-black uppercase text-slate-400 mb-2 px-2">Filtrar por Contrato</p>
        <select 
          className="w-full bg-white border-none rounded-xl p-3 text-xs font-bold text-slate-700 outline-none shadow-sm"
          value={selectedContractFilter}
          onChange={(e) => setSelectedContractFilter(e.target.value)}
        >
          <option value="ALL">TODOS LOS CONTRATOS</option>
          {contracts.map((c: any) => (
            <option key={c.id} value={c.id}>{c.id} - {c.delegacion}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#e2e8f0', fontSize: '3rem', fontWeight: 950 }}>...</div>
      ) : reports.filter((r: Report) => selectedContractFilter === 'ALL' || (r.contractid || r.contractId) === selectedContractFilter).length === 0 ? (
        <div style={{ padding: '3rem', background: '#f8fafc', borderRadius: '32px', textAlign: 'center', border: '2px dashed #f1f5f9' }}>
          <p className="subtitle-main" style={{ color: '#cbd5e1' }}>Sin reportes en este contrato</p>
        </div>
      ) : (
        <div className="log-list">
          {reports
            .filter((r: Report) => selectedContractFilter === 'ALL' || (r.contractid || r.contractId) === selectedContractFilter)
            .map((report) => (
            <div key={report.id} className="report-card" onClick={() => setSelectedReport(report)}>
               <div className="card-top">
                  <span className="folio-tag">{report.folio}</span>
                  <span className={`status-tag ${report.status === 'DETECTADO' ? 'status-detected' : 'status-process'}`}>
                    {report.status}
                  </span>
               </div>
               <div className="card-body">
                  <div className="location-snippet">
                    <MapPin size={12} className="text-cyan-500" />
                    <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{report.locationdesc || report.locationDesc}</p>
                  </div>
                  <div className="zone-chips">
                     <span className="chip">{report.delegacion}</span>
                  </div>
               </div>
            </div>
          ))}
        </div>
      )}

      {successModal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
           <div className="modal-content text-center">
              <div className="w-16 h-16 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-6">
                 <CheckCircle size={32} className="text-teal-500" />
              </div>
              <h2 className="text-xl font-black text-slate-800 mb-2">¡Completado!</h2>
              <p className="text-xs text-slate-400 font-bold mb-8">Información sincronizada satisfactoriamente.</p>
              <button className="action-btn-main" style={{ background: '#0f172a', color: 'white' }} onClick={() => setSuccessModal(false)}>
                ENTENDIDO
              </button>
           </div>
        </div>
      )}
    </div>
  )
}
