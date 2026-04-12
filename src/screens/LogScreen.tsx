import React, { useState, useEffect, useRef } from 'react'
import { RefreshCcw, FileText, MapPin, Camera, CheckCircle, ArrowRight, ChevronLeft, WifiOff } from 'lucide-react'
import SuccessModal from '../components/SuccessModal'
import { savePendingReport, getPendingReports } from '../lib/offlineStore'
import { compressImage } from '../lib/imageUtils'
import { apiFetch } from '../lib/apiFetch'
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
  isOffline?: boolean;
}

export default function LogScreen() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<any[]>([])
  const [selectedContractFilter, setSelectedContractFilter] = useState<string>('ALL')
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [measures, setMeasures] = useState<{largo: string, ancho: string, profundidad: string, m2: number}>({ 
    largo: '', ancho: '', profundidad: '', m2: 0 
  })
  const [currentStep, setCurrentStep] = useState<'PHOTO' | 'CONTINUE'>('PHOTO')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchReports = async () => {
    setLoading(true)
    try {
      // 1. Cargar reportes del servidor
      let apiReports: Report[] = []
      try {
        const response = await apiFetch('/api/reports')
        const json = await response.json()
        apiReports = Array.isArray(json) ? json : []
      } catch (e) {
        console.warn('[OFFLINE] No se pudo conectar al servidor, usando solo datos locales.')
      }

      // 2. Cargar reportes pendientes de IndexedDB
      const pending = await getPendingReports()
      
      // 3. Mapear aperturas pendientes a formato Report
      const pendingAperturas = pending
        .filter(p => p.type === 'APERTURA')
        .map(p => ({
          id: -(p.id || Date.now()), // ID negativo temporal
          folio: p.fields.folio,
          contractId: p.fields.contractId,
          locationDesc: p.fields.locationDesc,
          delegacion: p.fields.delegacion,
          colonia: p.fields.colonia,
          status: 'DETECTADO',
          created_at: p.savedAt,
          isOffline: true
        }))

      // 4. Integrar estados de actualizaciones pendientes
      const finalReports = [...apiReports]
      
      // Añadir aperturas que no están en el servidor
      pendingAperturas.forEach(pa => {
        if (!finalReports.find(r => r.folio === pa.folio)) {
          finalReports.unshift(pa as any)
        }
      })

      // Marcar reportes del servidor que tienen actualizaciones pendientes locales
      finalReports.forEach(r => {
        const relatedUpdates = pending.filter(p => p.type === 'UPDATE' && p.fields.folio === r.folio)
        if (relatedUpdates.length > 0) {
          // Si hay UN solo update de 'terminado' o varios que incluyan 'terminado', el estatus es TERMINADO
          const hasTerminado = relatedUpdates.some(up => up.phase === 'terminado')
          r.status = hasTerminado ? 'TERMINADO' : 'EN PROCESO'
          r.isOffline = true
        }
      })

      setReports(finalReports)
    } catch (err) {
      console.error('[SYNC ERROR] No se pudieron cargar los reportes.')
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
    
    let compressedBlob: Blob | null = null;
    try {
      compressedBlob = await compressImage(file);
    } catch (err) {
      setSyncStatus(`ERROR AL COMPRIMIR: ${err instanceof Error ? err.message : 'Fallo desconocido'}`);
      return;
    }

    try {
      const formData = new FormData()
      formData.append('photo', compressedBlob, 'upload.jpg')
      formData.append('phase', phase)
      
      if (phase === 'caja') {
        const calculatedTipo = parseFloat(measures.profundidad) > 0.07 ? 'CAJA PROFUNDA' : 'CAJA SUPERFICIAL'
        formData.append('largo', measures.largo)
        formData.append('ancho', measures.ancho)
        formData.append('profundidad', measures.profundidad)
        formData.append('m2', measures.m2.toString())
        formData.append('tipoBache', calculatedTipo)
      }

      const res = await apiFetch(`/api/reports/${selectedReport.folio}/photo`, {
        method: 'POST',
        body: formData
      })
      if (res.ok) {
        setShowSuccessModal(true)
        setSyncStatus(null)
        setCurrentStep('PHOTO') // Reset after success
        fetchReports()
        setSelectedReport(null) // Go back to list
        setMeasures({ largo: '', ancho: '', profundidad: '', m2: 0 }) // RESET
      } else if (res.status === 409) {
        setSyncStatus(`INFO: ESTE FOLIO YA TIENE ESTA FASE REGISTRADA.`)
        fetchReports() // Re-sincronizar UI
        setSelectedReport(null)
      } else {
        const error = await res.json()
        setSyncStatus(`ERROR: ${error.error || 'Fallo servidor'}`)
      }
    } catch (err) {
      // OFFLINE SUPPORT
      try {
        if (!compressedBlob) throw new Error("No hay imagen comprimida disponible");
        
        const photoBuffer = await compressedBlob.arrayBuffer();
        const calculatedTipo = phase === 'caja' 
          ? (parseFloat(measures.profundidad) > 0.07 ? 'CAJA PROFUNDA' : 'CAJA SUPERFICIAL')
          : (selectedReport.status === 'EN PROCESO' ? '' : 'SUPERFICIAL'); // fallback

        await savePendingReport({
          type: 'UPDATE',
          phase: phase as any,
          fields: {
            folio: selectedReport.folio,
            contractId: selectedReport.contractid || selectedReport.contractId || '',
            empresaName: '', 
            lat: 0, lng: 0, 
            largo: measures.largo,
            ancho: measures.ancho,
            profundidad: measures.profundidad,
            m2: measures.m2.toString(),
            locationDesc: selectedReport.locationdesc || selectedReport.locationDesc || '',
            calle1: '', calle2: '',
            delegacion: selectedReport.delegacion,
            colonia: selectedReport.colonia,
            tipoBache: calculatedTipo
          },
          photoBuffer,
          savedAt: new Date().toISOString()
        });
        
        setSyncStatus('FOTO GUARDADA LOCALMENTE (MODO OFFLINE)');
        setTimeout(() => {
          setShowSuccessModal(true);
          setSyncStatus(null);
          fetchReports();
          setSelectedReport(null);
          setMeasures({ largo: '', ancho: '', profundidad: '', m2: 0 });
        }, 1500);
      } catch (dbErr) {
        setSyncStatus(`FALLO CRÍTICO: ${dbErr instanceof Error ? dbErr.message : 'Error de almacenamiento'}`);
      }
    }
  }

  const handleContinue = async () => {
    if (!selectedReport) return
    const nextStatus = selectedReport.status === 'DETECTADO' ? 'EN PROCESO' : 'TERMINADO'
    
    setSyncStatus('ACTUALIZANDO...')
    try {
      const res = await apiFetch(`/api/reports/${selectedReport.folio}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      })
      
      if (res.ok) {
        setShowSuccessModal(true)
        setSelectedReport(null)
        setCurrentStep('PHOTO')
        setSyncStatus(null)
        fetchReports()
      }
    } catch (err) {
      setSyncStatus('FALLO DE RED (PATCH)')
    }
  }

  const handleMeasureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    const updated = { ...measures, [name]: value } as any
    if (name === 'largo' || name === 'ancho') {
      const l = parseFloat(name === 'largo' ? value : updated.largo) || 0
      const a = parseFloat(name === 'ancho' ? value : updated.ancho) || 0
      updated.m2 = parseFloat((l * a).toFixed(2))
    }
    setMeasures(updated)
  }


  if (selectedReport) {
    const isDetected = selectedReport.status === 'DETECTADO'
    const isInProcess = selectedReport.status === 'EN PROCESO'
    const isFinished = selectedReport.status === 'TERMINADO'

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
              <span className={`status-tag ${isDetected ? 'status-detected' : (isInProcess ? 'status-process' : 'status-finished')}`}>
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

          {!isFinished ? (
            <div className="action-module">
               <h3 className="text-sm font-black uppercase tracking-wider mb-6 text-center">
                  {currentStep === 'PHOTO' 
                     ? (isDetected ? 'Subir Foto Caja' : 'Subir Foto Final')
                     : 'Confirmar Seguimiento'
                  }
               </h3>

               <div className="flex flex-col gap-4">
                  {isDetected && (
                     <div className="calc-card">
                        <span className="calc-title">Medidas de Caja (M)</span>
                        <div className="calc-grid">
                           <div className="calc-item">
                              <label>Largo</label>
                              <input type="number" name="largo" className="calc-number" value={measures.largo} onChange={handleMeasureChange} placeholder="0" />
                           </div>
                           <div className="calc-item">
                              <label>Ancho</label>
                              <input type="number" name="ancho" className="calc-number" value={measures.ancho} onChange={handleMeasureChange} placeholder="0" />
                           </div>
                           <div className="calc-item">
                              <label>Prof.</label>
                              <input type="number" name="profundidad" className="calc-number" value={measures.profundidad} onChange={handleMeasureChange} placeholder="0" />
                           </div>
                        </div>
                        
                        <div className="calc-total">
                           <span className="total-label">Subtotal Cuantificado</span>
                           <div className="total-display">
                              <span className="huge-m2">{measures.m2}</span>
                              <span className="m2-unit">M²</span>
                           </div>
                        </div>

                        <div className="mt-4 flex gap-2 justify-center">
                           <span className={`badge-depth ${parseFloat(measures.profundidad) > 0.07 ? 'deep' : 'shallow'}`}>
                              {parseFloat(measures.profundidad) > 0.07 ? 'CAJA PROFUNDA' : 'CAJA SUPERFICIAL'}
                           </span>
                        </div>
                     </div>
                  )}

                  {currentStep === 'PHOTO' ? (
                    <button 
                      className="action-btn-main btn-upload" 
                      onClick={handlePhotoClick}
                      disabled={isDetected && (!measures.largo || !measures.ancho || !measures.profundidad)}
                      style={{ opacity: (isDetected && (!measures.largo || !measures.ancho || !measures.profundidad)) ? 0.5 : 1 }}
                    >
                      <Camera size={20} />
                      {isDetected ? 'TOMAR FOTO CAJA' : 'TOMAR FOTO FINAL'}
                    </button>
                  ) : (
                    <button className="action-btn-main btn-next" onClick={handleContinue}>
                      {isInProcess ? 'TERMINAR REPORTE' : 'CONFIRMAR CAJA'}
                      <ArrowRight size={20} />
                    </button>
                  )}
                  
                  {syncStatus && (
                     <div 
                       style={{
                         padding: '1rem',
                         borderRadius: '1rem',
                         textAlign: 'center',
                         fontSize: '8px',
                         fontWeight: 900,
                         textTransform: 'uppercase',
                         letterSpacing: '0.1em',
                         border: '1px solid',
                         transition: 'all 0.3s',
                         ...(syncStatus.includes('FALLO') || syncStatus.includes('ERROR')
                           ? { background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: '#ef4444' }
                           : { background: 'rgba(6,182,212,0.1)', borderColor: 'rgba(6,182,212,0.2)', color: '#22d3ee' }
                         )
                       }}
                     >
                      {syncStatus}
                    </div>
                  )}
                  
                  <input type="file" accept="image/*" capture="environment" hidden ref={fileInputRef} onChange={handleFileChange} />
               </div>
            </div>
          ) : (
            <div className="p-8 text-center" style={{ background: '#f0fdf4', borderRadius: '32px', marginTop: '2rem', border: '1px solid #dcfce7' }}>
              <CheckCircle size={40} className="mx-auto text-emerald-500 mb-4" />
              <h3 className="text-emerald-900 font-black uppercase text-sm mb-2">Proceso Concluido</h3>
              <p className="text-emerald-700 text-[10px] font-bold leading-relaxed">Este folio ha sido reparado y validado. No requiere acciones adicionales por parte del supervisor.</p>
            </div>
          )}
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
        <>
          <div className="log-list">
          {reports
            .filter((r: Report) => selectedContractFilter === 'ALL' || (r.contractid || r.contractId) === selectedContractFilter)
            .map((report) => (
            <div 
              key={report.folio} 
              className={`report-card ${report.status === 'TERMINADO' ? 'card-locked' : ''}`} 
              onClick={() => report.status !== 'TERMINADO' && setSelectedReport(report)}
            >
               <div className="card-top">
                  <span className="folio-tag">
                     {report.isOffline && <WifiOff size={14} className="inline mr-2 text-cyan-400" />}
                     {report.folio}
                  </span>
                  <span className={`status-tag ${report.status === 'DETECTADO' ? 'status-detected' : (report.status === 'EN PROCESO' ? 'status-process' : 'status-finished')} ${report.isOffline ? 'offline-tint' : ''}`}>
                    {report.isOffline 
                      ? (report.status === 'TERMINADO' ? 'TERMINADO (OFF)' : 'PENDIENTE') 
                      : report.status}
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
          <div className="p-4 text-center">
             <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Fin de la bitácora</p>
          </div>
        </>
      )}

      {showSuccessModal && (
        <SuccessModal 
          onClose={() => {
            setShowSuccessModal(false)
            setSelectedReport(null)
          }} 
        />
      )}
    </div>
  )
}
