import { useState } from 'react'
import { LayoutGrid, Plus, LayoutList, Map as MapIcon } from 'lucide-react'
import MetricsScreen from './screens/MetricsScreen'
import FormScreen from './screens/FormScreen'
import LogScreen from './screens/LogScreen'
import MapScreen from './screens/MapScreen'

type Tab = 'MAPA' | 'NUEVO' | 'BITACORA' | 'METRICAS'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('METRICAS')

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-top">
          <span className="brand-name">Bacheo <span className="brand-accent">Toluca</span></span>
          <div className="status-indicator">
            <span className="status-dot"></span>
            En Línea
          </div>
        </div>
        <nav className="header-nav">
          <TabButton 
            active={activeTab === 'MAPA'} 
            onClick={() => setActiveTab('MAPA')}
            label="Mapa"
            icon={<MapIcon size={20} />}
          />
          <TabButton 
            active={activeTab === 'NUEVO'} 
            onClick={() => setActiveTab('NUEVO')}
            label="Apertura"
            icon={<Plus size={20} />}
          />
          <TabButton 
            active={activeTab === 'BITACORA'} 
            onClick={() => setActiveTab('BITACORA')}
            label="Bitácora"
            icon={<LayoutList size={20} />}
          />
          <TabButton 
            active={activeTab === 'METRICAS'} 
            onClick={() => setActiveTab('METRICAS')}
            label="Métricas"
            icon={<LayoutGrid size={20} />}
          />
        </nav>
      </header>

      <main className="app-main overflow-y-auto">
        {activeTab === 'METRICAS' && <MetricsScreen />}
        {activeTab === 'NUEVO' && <FormScreen />}
        {activeTab === 'BITACORA' && <LogScreen />}
        {activeTab === 'MAPA' && <MapScreen />}
      </main>
    </div>
  )
}

function TabButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`tab-btn ${active ? 'active' : ''}`}
    >
      <div className="tab-icon">{icon}</div>
      <span className="tab-label">{label}</span>
      {active && <div className="tab-indicator" />}
    </button>
  )
}
