import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiFetch } from '../lib/apiFetch'
import './MapScreen.css'
import { Filter, Layers, ListFilter, MapPin, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react'

// Icon Generator
const createPotholeIcon = (status: string) => {
  let color = '#ef4444'; // DETECTADO
  if (status === 'EN PROCESO') color = '#f59e0b';
  if (status === 'TERMINADO') color = '#00b8a3';

  return new L.DivIcon({
    className: 'custom-pothole-icon',
    html: `<div style="background-color: ${color}; width: 14px; height: 14px; border: 3px solid white; border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.4);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
};

function MapFlyController({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom, { duration: 1.5 });
      setTimeout(() => map.invalidateSize(), 500);
    }
  }, [center, zoom, map]);
  return null;
}

export default function MapScreen() {
  const [delegations, setDelegations] = useState<any>(null)
  const [utbs, setUtbs] = useState<any>(null)
  const [reports, setReports] = useState<any[]>([])
  const [selectedDelegation, setSelectedDelegation] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('TODO')
  const [isRetracted, setIsRetracted] = useState<boolean>(true)
  const [mapConfig, setMapConfig] = useState<{ center: [number, number], zoom: number }>({
    center: [19.2818, -99.6616],
    zoom: 12
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/geojson/delegations').then(res => res.json()).then(data => { setDelegations(data); setLoading(false); }).catch(() => setLoading(false))
    fetch('/api/geojson').then(res => res.json()).then(data => setUtbs(data))
    apiFetch('/api/reports').then(res => res.json()).then(data => setReports(data))
  }, [])

  const delegationStyle = { fillColor: '#00b8a3', weight: 2, opacity: 1, color: '#0f172a', fillOpacity: 0.05 };
  const utbStyle = { fillColor: '#22d3ee', weight: 1, opacity: 0.8, color: 'white', fillOpacity: 0.2 };

  const onEachDelegation = (feature: any, layer: any) => {
    layer.on({ click: (e: any) => {
        const coords = e.latlng;
        setSelectedDelegation(feature.properties.NOMDEL);
        setMapConfig({ center: [coords.lat, coords.lng], zoom: 15 });
    }});
    layer.bindTooltip(feature.properties.NOMDEL, { sticky: true, className: 'nordic-tooltip' });
  };

  const filteredReports = reports.filter(r => {
    const geoMatch = selectedDelegation ? r.delegacion === selectedDelegation : true;
    const statusMatch = statusFilter === 'TODO' ? true : r.status === statusFilter;
    return geoMatch && statusMatch;
  });

  return (
    <div className="map-screen" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Top UI Overlay with Split Layout */}
      <div className="map-top-bar">
        {/* Left Side: Delegation Selector (Dropdown) */}
        <div style={{ pointerEvents: 'auto' }}>
           <div className="map-badge-nordic" style={{ padding: '0 8px 0 0' }}>
             <Layers size={14} style={{ marginLeft: '12px' }} />
             <select 
               className="delegation-select"
               value={selectedDelegation || ''}
               onChange={(e) => {
                 const name = e.target.value;
                 if (!name) {
                   setSelectedDelegation(null);
                   setMapConfig({ center: [19.2818, -99.6616], zoom: 12 });
                   return;
                 }
                 setSelectedDelegation(name);
                 // Find feature and center
                 const feature = delegations?.features.find((f: any) => f.properties.NOMDEL === name);
                 if (feature) {
                   const center = L.geoJSON(feature).getBounds().getCenter();
                   setMapConfig({ center: [center.lat, center.lng], zoom: 14 });
                 }
               }}
               style={{ 
                 background: 'transparent', 
                 border: 'none', 
                 color: 'inherit', 
                 fontFamily: 'inherit', 
                 fontSize: '0.65rem', 
                 fontWeight: 900, 
                 padding: '10px',
                 outline: 'none',
                 cursor: 'pointer',
                 width: '120px'
               }}
             >
                <option value="">TOLUCA (TODAS)</option>
                {delegations?.features.map((f: any) => (
                  <option key={f.properties.NOMDEL} value={f.properties.NOMDEL}>
                    {f.properties.NOMDEL}
                  </option>
                ))}
             </select>
           </div>
           
           {selectedDelegation && (
             <button className="map-badge-nordic" style={{ display: 'flex', marginTop: '0.5rem', background: '#0f172a', color: 'white' }} onClick={() => {
               setSelectedDelegation(null);
               setMapConfig({ center: [19.2818, -99.6616], zoom: 12 });
             }}>
               <ChevronLeft size={14} /> RESTABLECER
             </button>
           )}
        </div>

        {/* Right Side: Filters (As requested) */}
        <div className="filter-module-nordic">
           <div className="filter-label">
              <ListFilter size={10} />
              ETAPA
           </div>
           <select className="status-dropdown" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="TODO">TODOS</option>
              <option value="DETECTADO">📍 ROJOS</option>
              <option value="EN PROCESO">🚧 AMBAR</option>
              <option value="TERMINADO">✅ VERDES</option>
           </select>
        </div>
      </div>

      <MapContainer key="main-map" center={mapConfig.center} zoom={mapConfig.zoom} style={{ height: "100%", width: "100%" }} zoomControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapFlyController center={mapConfig.center} zoom={mapConfig.zoom} />

        {!selectedDelegation && delegations && (
          <GeoJSON key="delegations-layer" data={delegations} style={delegationStyle} onEachFeature={onEachDelegation} />
        )}

        {selectedDelegation && utbs && (
          <GeoJSON 
            key={`utbs-${selectedDelegation}`}
            data={{ ...utbs, features: utbs.features.filter((f: any) => f.properties.NOMDEL === selectedDelegation) }} 
            style={utbStyle} 
          />
        )}

        {filteredReports.map((report) => (
          (report.lat && report.lng) ? (
            <Marker key={`${report.id}-${report.status}`} position={[report.lat, report.lng] as any} // @ts-ignore
                icon={createPotholeIcon(report.status)}>
              <Popup>
                <div style={{ padding: '12px 16px', minWidth: '200px', backgroundColor: 'white' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 950, color: '#0f172a' }}>{report.folio}</span>
                    <span className={`status-tag-mini status-${report.status === 'DETECTADO' ? 'detected' : report.status === 'EN PROCESO' ? 'process' : 'finished'}`}>
                      {report.status}
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div>
                      <p style={{ fontSize: '8px', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>ZONA</p>
                      <p style={{ fontSize: '11px', fontWeight: 700, color: '#334155', margin: 0 }}>{report.delegacion} • {report.colonia}</p>
                    </div>
                    
                    <div>
                      <p style={{ fontSize: '8px', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', margin: 0, letterSpacing: '0.05em' }}>REGISTRO</p>
                      <p style={{ fontSize: '11px', fontWeight: 700, color: '#334155', margin: 0 }}>
                        {new Date(report.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: '10px', marginTop: '4px', border: '1px solid #f1f5f9' }}>
                      <p style={{ fontSize: '8px', fontWeight: 900, color: '#64748b', textTransform: 'uppercase', margin: '0 0 2px 0' }}>REFERENCIA</p>
                      <p style={{ fontSize: '10px', fontWeight: 500, color: '#475569', margin: 0, lineHeight: '1.2' }}>
                        {report.locationdesc || report.locationDesc}
                      </p>
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          ) : null
        ))}
      </MapContainer>

      {/* Retractable Bottom Summary Bar */}
      <div className={`map-bottom-nav ${isRetracted ? 'is-retracted' : ''}`}>
         <div className="summary-card-nordic">
            {/* Handle for dragging/clicking */}
            <div className="retract-handle" onClick={() => setIsRetracted(!isRetracted)} />
            
            <div className="summary-info" onClick={() => setIsRetracted(!isRetracted)}>
               <div>
                  <p className="summary-title">{statusFilter === 'TODO' ? 'Resumen General' : `Filtrado: ${statusFilter}`}</p>
                  <p className="summary-value">
                    {filteredReports.length} <span className="text-xs font-black text-slate-300">BACHES</span>
                  </p>
               </div>
               <div className="text-cyan-500 opacity-80 flex items-center justify-center p-2 rounded-full hover:bg-slate-50">
                  {isRetracted ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
               </div>
            </div>

            <div className="counter-grid-mini">
               <div className="stat-box-mini bg-red-nordic">
                  <span>{reports.filter((r: any) => r.status === 'DETECTADO').length}</span>
                  <span>Rojos</span>
               </div>
               <div className="stat-box-mini bg-amber-nordic">
                  <span>{reports.filter((r: any) => r.status === 'EN PROCESO').length}</span>
                  <span>Ámbar</span>
               </div>
               <div className="stat-box-mini bg-teal-nordic">
                  <span>{reports.filter((r: any) => r.status === 'TERMINADO').length}</span>
                  <span>Hechos</span>
               </div>
            </div>
         </div>
      </div>
    </div>
  )
}
