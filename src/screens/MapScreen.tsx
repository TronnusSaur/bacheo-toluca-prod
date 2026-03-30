import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
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
    fetch('/api/reports').then(res => res.json()).then(data => setReports(data))
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
        {/* Left Side: Delegation Indicator */}
        <div style={{ pointerEvents: 'auto' }}>
           <div className="map-badge-nordic">
             <Layers size={14} />
             {loading ? 'CARGANDO...' : (selectedDelegation ? selectedDelegation : 'TOLUCA')}
           </div>
           
           {selectedDelegation && (
             <button className="map-badge-nordic" style={{ display: 'flex', marginTop: '0.5rem', background: '#0f172a', color: 'white' }} onClick={() => {
               setSelectedDelegation(null);
               setMapConfig({ center: [19.2818, -99.6616], zoom: 12 });
             }}>
               <ChevronLeft size={14} /> VOLVER
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
                <div className="p-4" style={{ minWidth: '180px' }}>
                  <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                    <h4 className="text-sm font-black text-slate-900 m-0">{report.folio}</h4>
                    <span className={`status-tag-mini status-${report.status === 'DETECTADO' ? 'detected' : report.status === 'EN PROCESO' ? 'process' : 'finished'}`}>
                      {report.status}
                    </span>
                  </div>
                  <div className="popup-details">
                    <div className="mb-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5 leading-none">Delegación</p>
                      <p className="text-xs font-bold text-slate-700 m-0">{report.delegacion}</p>
                    </div>
                    
                    <div className="mb-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5 leading-none">Colonia / UT</p>
                      <p className="text-xs font-bold text-slate-700 m-0">{report.colonia}</p>
                    </div>
                    
                    <div className="mb-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5 leading-none">Fecha de Registro</p>
                      <p className="text-xs font-bold text-slate-700 m-0">
                        {new Date(report.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-50">
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5 leading-none italic">Ubicación Ref.</p>
                      <p className="text-[10px] font-bold text-slate-500 m-0 leading-tight">
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
