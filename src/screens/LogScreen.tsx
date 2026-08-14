import React, { useState, useEffect, useRef } from 'react'
import { 
  RefreshCcw, MapPin, Camera, CheckCircle, ChevronLeft, WifiOff, 
  DatabaseBackup, Search, X, Calendar, User, Layers, 
  Image as ImageIcon, Maximize2, Ruler, ExternalLink, ArrowRight 
} from 'lucide-react'
import SuccessModal from '../components/SuccessModal'
import { saveReportJSON, saveReportPhoto, getPendingItems, getReportJSON, addPendingItem, clearReportFiles } from '../lib/robustStore'
import { Preferences } from '@capacitor/preferences'
import { supabase } from '../lib/supabase'
import { compressImage } from '../lib/imageUtils'
import { apiFetch } from '../lib/apiFetch'
import './LogScreen.css'

interface Report {
  id: number;
  folio: string;
  contractid?: string;
  contractId?: string;
  empresaname?: string;
  empresaName?: string;
  locationdesc?: string;
  locationDesc?: string;
  delegacion: string;
  colonia: string;
  lat?: number;
  lng?: number;
  largo?: number | string;
  ancho?: number | string;
  profundidad?: number | string;
  m2?: number | string;
  tipoBache?: string;
  tipobache?: string;
  status: string;
  created_at: string;
  created_by?: string;
  updated_by?: string;
  photoUrl?: string;
  photourl?: string;
  photoCaja?: string;
  photocaja?: string;
  photoFinal?: string;
  photofinal?: string;
  calle_1?: string;
  calle1?: string;
  calle_2?: string;
  calle2?: string;
  isOffline?: boolean;
  serverMissing?: boolean;
}

export default function LogScreen({ userProfile }: { userProfile: any }) {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [contracts, setContracts] = useState<any[]>([])
  const [selectedContractFilter, setSelectedContractFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState<string>('')
  
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [activePhotoTab, setActivePhotoTab] = useState<'inicial' | 'caja' | 'final'>('inicial')
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [measures, setMeasures] = useState<{largo: string, ancho: string, profundidad: string, m2: number}>({ 
    largo: '', ancho: '', profundidad: '', m2: 0 
  })
  const [currentStep, setCurrentStep] = useState<'PHOTO' | 'CONTINUE'>('PHOTO')
  const [syncingFolios, setSyncingFolios] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const normFolio = (f: string) => String(f || '').trim().replace(/^'/, '').padStart(6, '0');

  const getPhotoForPhase = (report: Report, phase: 'inicial' | 'caja' | 'final'): string => {
    if (phase === 'inicial') return report.photoUrl || report.photourl || '';
    if (phase === 'caja') return report.photoCaja || report.photocaja || '';
    if (phase === 'final') return report.photoFinal || report.photofinal || '';
    return '';
  };

  const buildFinalReports = (apiReports: Report[], pending: any[]) => {
    const pendingAperturas = pending
      .filter(p => p.type === 'APERTURA')
      .map(p => ({
        id: -Math.abs((p.fields?.folio || '').split('').reduce((a: number, b: string) => { const h = (a << 5) - a + b.charCodeAt(0); return h & h; }, 0) || Date.now()),
        folio: p.fields?.folio || '',
        contractId: p.fields?.contractId || '',
        locationDesc: p.fields?.locationDesc || '',
        delegacion: p.fields?.delegacion || '',
        colonia: p.fields?.colonia || '',
        status: 'DETECTADO',
        created_at: p.savedAt,
        isOffline: true,
        serverMissing: p.serverMissing
      }))

    const filteredPending = userProfile?.role === 'ADMIN'
      ? pendingAperturas
      : pendingAperturas.filter(p => userProfile?.assignments?.includes(p.contractId));

    const finalReports = [...apiReports]
    filteredPending.forEach(pa => {
      if (!finalReports.find(r => normFolio(r.folio) === normFolio(pa.folio))) {
        finalReports.unshift(pa as any)
      }
    })
    finalReports.forEach(r => {
      const relatedUpdates = pending.filter(p => p.type === 'UPDATE' && normFolio(p.fields?.folio) === normFolio(r.folio))
      if (relatedUpdates.length > 0) {
        const hasTerminado = relatedUpdates.some(up => up.phase === 'terminado')
        r.status = hasTerminado ? 'TERMINADO' : 'EN PROCESO'
        r.isOffline = true
      }
    })
    return finalReports
  }

  const loadPendingItems = async () => {
    const pendingItems = await getPendingItems()
    const pending: any[] = []
    for (const itemKey of pendingItems) {
      const parts = itemKey.split('_')
      const folio = parts[0]
      const phase = parts.slice(1).join('_')
      const reportData = await getReportJSON(folio, phase)
      if (reportData) pending.push(reportData)
    }
    return pending
  }

  const fetchReports = async () => {
    // ─── PASO 1: CACHÉ INSTANTÁNEO (0ms) ─────────────────────────────────────
    const { value: cachedValue } = await Preferences.get({ key: 'cached_reports_list' })
    if (cachedValue) {
      try {
        const cached: Report[] = JSON.parse(cachedValue)
        if (cached.length > 0) {
          const pending = await loadPendingItems()
          setReports(buildFinalReports(cached, pending))
          setLoading(false)
        }
      } catch { /* ignorar parse error */ }
    }

    // ─── PASO 2: ACTUALIZAR DESDE SERVIDOR EN BACKGROUND ─────────────────────
    try {
      const response = await apiFetch('/api/reports')
      if (response.ok) {
        const json = await response.json()
        const freshReports: Report[] = Array.isArray(json) ? json : []
        await Preferences.set({ key: 'cached_reports_list', value: JSON.stringify(freshReports) })
        
        // Auto-limpieza de la cola offline si el folio ya está registrado en el servidor
        const currentPendingKeys = await getPendingItems()
        for (const itemKey of currentPendingKeys) {
          const parts = itemKey.split('_')
          const folio = parts[0]
          const phase = parts.slice(1).join('_')
          const serverReport = freshReports.find(r => normFolio(r.folio) === normFolio(folio))
          if (serverReport) {
            if (phase === 'inicial' || (phase === 'caja' && serverReport.status !== 'DETECTADO') || (phase === 'terminado' && serverReport.status === 'TERMINADO')) {
              await clearReportFiles(folio, phase)
            }
          }
        }

        const pending = await loadPendingItems()
        setReports(buildFinalReports(freshReports, pending))
      }
    } catch (e) {
      console.warn('[OFFLINE] No se pudo conectar al servidor, usando datos del cache.')
    } finally {
      setLoading(false)
    }
  }

  const fetchContracts = async () => {
    try {
      const response = await apiFetch('/api/catalogs/contracts')
      const data = await response.json()
      setContracts(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('[API ERROR] No se pudo cargar el catálogo de contratos.')
    }
  }

  useEffect(() => {
    fetchReports()
    fetchContracts()
  }, [])

  useEffect(() => {
    const handleStart = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { folio } = customEvent.detail;
      setSyncingFolios(prev => [...new Set([...prev, folio])]);
    };

    const handleEnd = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { folio } = customEvent.detail;
      setSyncingFolios(prev => prev.filter(f => f !== folio));
      fetchReports();
    };

    window.addEventListener('sync-item-start', handleStart);
    window.addEventListener('sync-item-end', handleEnd);

    return () => {
      window.removeEventListener('sync-item-start', handleStart);
      window.removeEventListener('sync-item-end', handleEnd);
    };
  }, []);

  const handlePhotoClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedReport) return

    const report = selectedReport;
    const phase = report.status === 'DETECTADO' ? 'caja' : 'terminado'
    setSyncStatus(`COMPRIMIENDO FOTO...`)
    
    let compressedBlob: Blob | null = null;
    try {
      compressedBlob = await compressImage(file);
    } catch (err) {
      setSyncStatus(`ERROR AL COMPRIMIR: ${err instanceof Error ? err.message : 'Fallo desconocido'}`);
      return;
    }

    setSyncStatus('SUBIENDO FOTO...');
    try {
      const formData = new FormData()
      formData.append('photo', compressedBlob, 'upload.jpg')
      formData.append('phase', phase)
      formData.append('contractId', report.contractid || report.contractId || '')
      formData.append('empresaName', report.empresaname || report.empresaName || '')
      
      if (phase === 'caja') {
        const calculatedTipo = parseFloat(measures.profundidad) > 0.07 ? 'CAJA PROFUNDA' : 'CAJA SUPERFICIAL'
        formData.append('largo', measures.largo)
        formData.append('ancho', measures.ancho)
        formData.append('profundidad', measures.profundidad)
        formData.append('m2', measures.m2.toString())
        formData.append('tipoBache', calculatedTipo)
      }

      const res = await apiFetch(`/api/reports/${report.folio}/photo`, {
        method: 'POST',
        body: formData
      })

      if (res.ok) {
        // Direct local Supabase update from client
        try {
          const updates: any = {
            status: phase === 'caja' ? 'EN PROCESO' : 'TERMINADO',
            updated_by: userProfile?.email || 'admin@bacheo.gob.mx',
          };
          if (phase === 'caja') {
            updates.largo = parseFloat(measures.largo) || 0;
            updates.ancho = parseFloat(measures.ancho) || 0;
            updates.profundidad = parseFloat(measures.profundidad) || 0;
            updates.m2 = measures.m2 || 0;
            updates.tipoBache = parseFloat(measures.profundidad) > 0.07 ? 'CAJA PROFUNDA' : 'CAJA SUPERFICIAL';
          }
          await supabase.from('bacheo_pruebas_app').update(updates).eq('folio', report.folio);
          console.log('[SUPABASE LOCAL] ✅ Update guardado en Supabase para:', report.folio);
        } catch (_) {}

        await clearReportFiles(report.folio, phase);
        setShowSuccessModal(true);
        setSyncStatus(null);
        setCurrentStep('PHOTO');
        fetchReports();
        setSelectedReport(null);
        setMeasures({ largo: '', ancho: '', profundidad: '', m2: 0 });
        return;
      }

      if (res.status === 409) {
        setSyncStatus(`INFO: ESTE FOLIO YA TIENE ESTA FASE REGISTRADA.`)
        fetchReports()
        setSelectedReport(null)
        return;
      }

      if (res.status === 404) {
        console.warn(`[FALLBACK-404] Folio ${report.folio} no existe en servidor aún. Guardando foto localmente.`);
        await saveToOffline(phase, compressedBlob, report);
        return;
      }

      let errorMsg = 'Fallo del servidor';
      try {
        const errorBody = await res.json();
        errorMsg = errorBody.error || errorMsg;
      } catch (_) { /* ignore */ }
      setSyncStatus(`ERROR: ${errorMsg} (${res.status})`);

    } catch (err) {
      console.warn(`[FALLBACK-NET] Error de red al subir foto de ${report.folio}. Guardando localmente.`, err);
      await saveToOffline(phase, compressedBlob, report);
    }
  }

  const saveToOffline = async (phase: string, compressedBlob: Blob | null, report: Report) => {
    try {
      const calculatedTipo = phase === 'caja' 
        ? (parseFloat(measures.profundidad) > 0.07 ? 'CAJA PROFUNDA' : 'CAJA SUPERFICIAL')
        : '';

      await saveReportJSON(report.folio, phase, {
        type: 'UPDATE',
        phase: phase as any,
        fields: {
          folio: report.folio,
          contractId: report.contractid || report.contractId || '',
          empresaName: report.empresaname || report.empresaName || '', 
          lat: 0, lng: 0, 
          largo: measures.largo,
          ancho: measures.ancho,
          profundidad: measures.profundidad,
          m2: measures.m2.toString(),
          locationDesc: report.locationdesc || report.locationDesc || '',
          calle1: '', calle2: '',
          delegacion: report.delegacion,
          colonia: report.colonia,
          tipoBache: calculatedTipo
        },
        savedAt: new Date().toISOString(),
        serverMissing: true
      });

      if (compressedBlob) {
        await saveReportPhoto(report.folio, phase, compressedBlob);
      }

      await addPendingItem(`${report.folio}_${phase}`);
      
      setSyncStatus('FOTO GUARDADA LOCALMENTE. SE SUBIRÁ AUTOMÁTICAMENTE.');
      setTimeout(() => {
        setShowSuccessModal(true);
        setSyncStatus(null);
        fetchReports();
        setSelectedReport(null);
        setMeasures({ largo: '', ancho: '', profundidad: '', m2: 0 });
      }, 1800);
    } catch (dbErr) {
      setSyncStatus(`FALLO CRÍTICO: ${dbErr instanceof Error ? dbErr.message : 'Error de almacenamiento'}`);
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

  // --- FILTERED REPORTS ---
  const filteredReports = reports.filter(r => {
    const matchesSearch = !searchQuery || 
      r.folio.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.locationdesc || r.locationDesc || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.colonia || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (r.delegacion || '').toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const matchesContract = selectedContractFilter === 'ALL' || (r.contractid || r.contractId) === selectedContractFilter;
    return matchesSearch && matchesStatus && matchesContract;
  });

  // --- DETAIL / DOSSIER VIEW ---
  if (selectedReport) {
    const isDetected = selectedReport.status === 'DETECTADO'
    const isInProcess = selectedReport.status === 'EN PROCESO'
    const isFinished = selectedReport.status === 'TERMINADO'

    const photoInicial = getPhotoForPhase(selectedReport, 'inicial');
    const photoCaja = getPhotoForPhase(selectedReport, 'caja');
    const photoFinal = getPhotoForPhase(selectedReport, 'final');

    let activePhotoUrl = '';
    if (activePhotoTab === 'inicial') activePhotoUrl = photoInicial;
    else if (activePhotoTab === 'caja') activePhotoUrl = photoCaja;
    else if (activePhotoTab === 'final') activePhotoUrl = photoFinal;

    const lat = selectedReport.lat || 0;
    const lng = selectedReport.lng || 0;
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

    const c1 = selectedReport.calle_1 || selectedReport.calle1 || '';
    const c2 = selectedReport.calle_2 || selectedReport.calle2 || '';
    let entreCalles = '';
    if (c1 && c2) entreCalles = `${c1} Y ${c2}`;
    else if (c1) entreCalles = c1;
    else if (c2) entreCalles = c2;

    return (
      <div className="log-container dossier-view animate-in">
        {/* Back Button */}
        <button 
          className="back-btn-nordic" 
          onClick={() => { setSelectedReport(null); setLightboxImage(null); setSyncStatus(null); }}
        >
          <ChevronLeft size={16} /> REGRESAR A BITÁCORA
        </button>

        {/* Dossier Card 1: Main Header Info */}
        <div className="dossier-card">
          <div className="dossier-header">
            <div>
              <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase block">EXPEDIENTE DIGITAL</span>
              <h2 className="dossier-folio">Folio {selectedReport.folio}</h2>
            </div>
            <span className={`status-tag ${isDetected ? 'status-detected' : (isInProcess ? 'status-process' : 'status-finished')}`}>
              {selectedReport.status}
            </span>
          </div>

          <div className="dossier-meta">
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-cyan-600 flex-shrink-0" />
              <span>Capturado: {selectedReport.created_at || 'Fecha no disponible'}</span>
            </div>
            <div className="flex items-center gap-2">
              <User size={14} className="text-cyan-600 flex-shrink-0" />
              <span>Responsable: {selectedReport.created_by || selectedReport.updated_by || 'Cuadrilla de Bacheo'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-cyan-600 flex-shrink-0" />
              <span>{selectedReport.empresaname || selectedReport.empresaName || selectedReport.contractid || selectedReport.contractId || 'Bacheo Toluca'}</span>
            </div>
          </div>
        </div>

        {/* Dossier Card 2: Interactive Live Photo Gallery */}
        <div className="dossier-card">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
              <ImageIcon size={14} className="text-cyan-600" /> Registro Fotográfico en Vivo
            </h3>
          </div>

          {/* Phase Tabs */}
          <div className="gallery-tabs">
            <button 
              className={`gallery-tab ${activePhotoTab === 'inicial' ? 'active' : ''}`}
              onClick={() => setActivePhotoTab('inicial')}
            >
              1. Inicial {photoInicial ? '✅' : '⏳'}
            </button>
            <button 
              className={`gallery-tab ${activePhotoTab === 'caja' ? 'active' : ''}`}
              onClick={() => setActivePhotoTab('caja')}
            >
              2. Caja {photoCaja ? '✅' : '⏳'}
            </button>
            <button 
              className={`gallery-tab ${activePhotoTab === 'final' ? 'active' : ''}`}
              onClick={() => setActivePhotoTab('final')}
            >
              3. Final {photoFinal ? '✅' : '⏳'}
            </button>
          </div>

          {/* Image Display Container */}
          <div className="photo-preview-box">
            {activePhotoUrl ? (
              <>
                <img 
                  src={activePhotoUrl} 
                  alt={`Fase ${activePhotoTab}`} 
                  className="photo-preview-img"
                  onClick={() => setLightboxImage(activePhotoUrl)}
                  onError={(e) => {
                    const target = e.currentTarget;
                    const fileIdMatch = activePhotoUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                    if (fileIdMatch && fileIdMatch[1]) {
                      target.src = `https://drive.google.com/thumbnail?id=${fileIdMatch[1]}&sz=w1000`;
                    }
                  }}
                />
                <div className="photo-zoom-hint">
                  <Maximize2 size={12} /> Toca para ampliar
                </div>
              </>
            ) : (
              <div className="no-photo-box">
                <ImageIcon size={32} opacity={0.3} />
                <span>Fotografía no registrada para fase {activePhotoTab.toUpperCase()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Dossier Card 3: Technical Metrics */}
        <div className="dossier-card">
          <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
            <Ruler size={14} className="text-cyan-600" /> Cuantificación y Ficha Técnica
          </h3>

          <div className="specs-grid">
            <div className="spec-item">
              <span className="spec-label">Largo</span>
              <span className="spec-val">{selectedReport.largo || '0'} m</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">Ancho</span>
              <span className="spec-val">{selectedReport.ancho || '0'} m</span>
            </div>
            <div className="spec-item">
              <span className="spec-label">Profundidad</span>
              <span className="spec-val">{selectedReport.profundidad || '0'} m</span>
            </div>
            <div className="spec-item" style={{ background: 'rgba(2,132,199,0.06)' }}>
              <span className="spec-label" style={{ color: '#0284c7' }}>Área Total</span>
              <span className="spec-val highlight">{selectedReport.m2 || '0'} m²</span>
            </div>
          </div>

          <div className="mt-3 flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Clasificación Técnica</span>
            <span className="text-xs font-black text-cyan-600 uppercase">
              {(parseFloat(String(selectedReport.profundidad || 0)) > 0.07) ? 'PROFUNDO' : (selectedReport.tipoBache || selectedReport.tipobache || 'SUPERFICIAL')}
            </span>
          </div>
        </div>

        {/* Dossier Card 4: Location & Maps */}
        <div className="dossier-card">
          <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-2">
            <MapPin size={14} className="text-cyan-600" /> Ubicación y Georreferenciación
          </h3>

          <div className="location-list">
            <div className="loc-item">
              <span className="loc-label">Delegación / Colonia</span>
              <span className="loc-val">{selectedReport.delegacion || 'TOLUCA'} — {selectedReport.colonia || 'CENTRO'}</span>
            </div>
            <div className="loc-item">
              <span className="loc-label">Calle Principal / Ubicación</span>
              <span className="loc-val">{selectedReport.locationdesc || selectedReport.locationDesc || 'No especificada'}</span>
            </div>
            {entreCalles && (
              <div className="loc-item">
                <span className="loc-label">Entre Calles</span>
                <span className="loc-val">{entreCalles}</span>
              </div>
            )}
            {lat !== 0 && lng !== 0 && (
              <div className="loc-item">
                <span className="loc-label">Coordenadas GPS</span>
                <span className="loc-val font-mono text-xs text-slate-500">{lat}, {lng}</span>
              </div>
            )}
          </div>

          {lat !== 0 && lng !== 0 && (
            <a 
              href={mapsUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn-maps-link"
            >
              <MapPin size={16} /> Abrir Ubicación en Google Maps <ExternalLink size={14} />
            </a>
          )}
        </div>

        {/* Action Module for Ongoing Reports */}
        {!isFinished && (
          <div className="action-module">
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 text-center">
              {isDetected ? 'Capturar Fase 2: Caja' : 'Capturar Fase 3: Terminado'}
            </h3>

            {isDetected && (
              <div className="calc-card mb-4">
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
                <div className="m2-display">
                  <span className="text-slate-400">Área Calculada:</span>
                  <span className="text-cyan-400 font-mono text-sm">{measures.m2} m²</span>
                </div>
              </div>
            )}

            <button className="action-btn-main btn-upload" onClick={handlePhotoClick}>
              <Camera size={18} /> {isDetected ? 'Tomar Foto de Caja' : 'Tomar Foto de Terminado'}
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              capture="environment" 
              style={{ display: 'none' }} 
            />

            {syncStatus && (
              <p className="text-[10px] font-bold text-center text-cyan-300 uppercase tracking-widest mt-3">
                {syncStatus}
              </p>
            )}
          </div>
        )}

        {/* Lightbox Fullscreen Modal */}
        {lightboxImage && (
          <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
            <button className="lightbox-close" onClick={() => setLightboxImage(null)}>
              <X size={24} />
            </button>
            <img src={lightboxImage} alt="Vista ampliada" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
          </div>
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
    );
  }

  // --- MAIN CONSULTOR LIST VIEW ---
  return (
    <div className="log-container animate-in">
      {/* Header */}
      <div className="log-header">
        <div>
          <h1 className="title-main">Bitácora</h1>
          <p className="subtitle-main">Consultor de Folios y Expedientes</p>
        </div>
        <button 
          onClick={fetchReports} 
          className="p-2" 
          style={{ background: '#f8fafc', border: 'none', borderRadius: '12px', cursor: 'pointer', color: '#0891b2' }}
          title="Actualizar datos"
        >
          <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {syncStatus && (
        <div 
          style={{
            padding: '1rem',
            borderRadius: '1rem',
            textAlign: 'center',
            fontSize: '9px',
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            border: '1px solid',
            marginBottom: '1rem',
            transition: 'all 0.3s',
            ...(syncStatus.includes('FALLO') || syncStatus.includes('ERROR') || syncStatus.includes('SIN CONEXIÓN')
              ? { background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: '#ef4444' }
              : { background: 'rgba(6,182,212,0.1)', borderColor: 'rgba(6,182,212,0.2)', color: '#22d3ee' }
            )
          }}
        >
          {syncStatus}
        </div>
      )}

      {/* Search & Filter Controls */}
      <div className="search-filter-box">
        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" />
          <input 
            type="text" 
            className="search-input"
            placeholder="Buscar por folio, calle o colonia..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              className="absolute right-3 text-slate-400 hover:text-slate-600" 
              onClick={() => setSearchQuery('')}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Status Filter Pills */}
        <div className="filter-pills">
          <button 
            className={`filter-pill ${statusFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setStatusFilter('ALL')}
          >
            Todos ({reports.length})
          </button>
          <button 
            className={`filter-pill ${statusFilter === 'TERMINADO' ? 'active' : ''}`}
            onClick={() => setStatusFilter('TERMINADO')}
          >
            Terminados ({reports.filter(r => r.status === 'TERMINADO').length})
          </button>
          <button 
            className={`filter-pill ${statusFilter === 'EN PROCESO' ? 'active' : ''}`}
            onClick={() => setStatusFilter('EN PROCESO')}
          >
            En Proceso ({reports.filter(r => r.status === 'EN PROCESO').length})
          </button>
          <button 
            className={`filter-pill ${statusFilter === 'DETECTADO' ? 'active' : ''}`}
            onClick={() => setStatusFilter('DETECTADO')}
          >
            Detectados ({reports.filter(r => r.status === 'DETECTADO').length})
          </button>
        </div>
      </div>

      {/* Filter by Contract Dropdown */}
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

      {/* Reports List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#e2e8f0', fontSize: '3rem', fontWeight: 950 }}>...</div>
      ) : filteredReports.length === 0 ? (
        <div style={{ padding: '3rem', background: '#f8fafc', borderRadius: '32px', textAlign: 'center', border: '2px dashed #f1f5f9' }}>
          <p className="subtitle-main" style={{ color: '#cbd5e1' }}>
            {searchQuery ? 'No se encontraron folios con ese criterio' : 'Sin reportes registrados'}
          </p>
        </div>
      ) : (
        <>
          <div className="log-list">
            {filteredReports.map((report) => {
              const photoInicial = getPhotoForPhase(report, 'inicial');
              const photoCaja = getPhotoForPhase(report, 'caja');
              const photoFinal = getPhotoForPhase(report, 'final');

              return (
                <div 
                  key={report.folio} 
                  className="report-card" 
                  onClick={async () => {
                    if (report.isOffline) {
                      if (navigator.onLine) {
                        setSyncStatus(`SINCRONIZANDO FOLIO ${report.folio} MANUALMENTE...`);
                        const { syncPendingReports } = await import('../lib/syncService');
                        syncPendingReports(({ synced, failed }) => {
                          if (synced > 0) {
                            setSyncStatus(`FOLIO ${report.folio} SINCRONIZADO.`);
                            setTimeout(() => setSyncStatus(null), 3000);
                          } else if (failed > 0) {
                            setSyncStatus(`ERROR AL SINCRONIZAR FOLIO ${report.folio}.`);
                            setTimeout(() => setSyncStatus(null), 3000);
                          } else {
                            setSyncStatus(null);
                          }
                        });
                        return;
                      }
                    }
                    // Open Dossier / Detail view for any report clicked
                    setSelectedReport(report);
                    if (report.status === 'TERMINADO') {
                      setActivePhotoTab('final');
                    } else if (report.status === 'EN PROCESO') {
                      setActivePhotoTab('caja');
                    } else {
                      setActivePhotoTab('inicial');
                    }
                  }}
                >
                  <div className="card-top">
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <span className="folio-tag">
                        {syncingFolios.includes(report.folio) ? (
                          <RefreshCcw size={14} className="inline mr-2 text-emerald-400 animate-spin" />
                        ) : (
                          <>
                            {report.isOffline && !report.serverMissing && <WifiOff size={14} className="inline mr-2 text-cyan-400" />}
                            {(report.isOffline && report.serverMissing && userProfile?.role === 'ADMIN') && <DatabaseBackup size={14} className="inline mr-2 text-rose-500" />}
                            {(report.isOffline && report.serverMissing && userProfile?.role !== 'ADMIN') && <WifiOff size={14} className="inline mr-2 text-cyan-400" />}
                          </>
                        )}
                        {report.folio}
                      </span>
                    </div>
                    <span className={`status-tag ${syncingFolios.includes(report.folio) ? 'status-syncing' : (report.status === 'DETECTADO' ? 'status-detected' : (report.status === 'EN PROCESO' ? 'status-process' : 'status-finished'))} ${report.isOffline && !syncingFolios.includes(report.folio) ? 'offline-tint' : ''}`}>
                      {syncingFolios.includes(report.folio)
                        ? 'SUBIENDO...'
                        : (report.isOffline 
                            ? (report.status === 'TERMINADO' ? 'TERMINADO (OFF)' : 'PENDIENTE') 
                            : report.status)
                      }
                    </span>
                  </div>

                  <div className="card-body">
                    <div className="location-snippet">
                      <MapPin size={13} className="text-cyan-600 flex-shrink-0" />
                      <p style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                        {report.locationdesc || report.locationDesc || report.calle_1 || 'Ubicación sin referencia'}
                      </p>
                    </div>
                    
                    <div className="zone-chips">
                      <span className="chip">{report.delegacion || 'TOLUCA'}</span>
                      <span className="chip">{report.colonia || 'CENTRO'}</span>
                    </div>

                    <div className="card-footer-info">
                      <span className="m2-badge">{report.m2 || '0'} m²</span>
                      <div className="photo-dots">
                        <span>Fotos:</span>
                        <span className={`photo-dot ${photoInicial ? 'active' : ''}`} title="Inicial" />
                        <span className={`photo-dot ${photoCaja ? 'active' : ''}`} title="Caja" />
                        <span className={`photo-dot ${photoFinal ? 'active' : ''}`} title="Final" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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
