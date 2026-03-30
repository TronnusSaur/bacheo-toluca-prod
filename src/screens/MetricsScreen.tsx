import { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import './MetricsScreen.css'

export default function MetricsScreen() {
  const [stats, setStats] = useState({
    total: 0,
    m2: 0,
    completed: 0,
    pending: 0
  })

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/reports')
      const data = await response.json()
      const totalM2 = data.reduce((acc: number, r: any) => acc + (r.m2 || 0), 0)
      setStats({
        total: data.length,
        m2: parseFloat(totalM2.toFixed(1)),
        completed: 0,
        pending: data.length
      })
    } catch (err) {
      console.error('[SIMULACIÓN ERROR] No se pudieron cargar métricas.')
    }
  }

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [])

  const pieData = [
    { name: 'Pendientes', value: stats.total || 0, color: '#f59e0b' },
    { name: 'Terminados', value: stats.completed, color: '#00b8a3' },
  ]

  return (
    <div className="metrics-container p-6">
      <div className="mb-8">
        <h1 className="metrics-title">Centro de Control</h1>
        <p className="text-[10px] font-bold text-cyan-600 tracking-widest uppercase mt-1">
          ⚠️ ESTADÍSTICAS DE SIMULACIÓN (PRUEBA)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="nordic-card">
          <h3 className="card-title">Baches en Prueba</h3>
          <div className="huge-number">{stats.total}</div>
        </div>
        <div className="nordic-card">
          <h3 className="card-title">M² Totales [SIM]</h3>
          <div className="huge-number teal">{stats.m2}</div>
        </div>
      </div>

      <div className="nordic-card mb-6">
        <h3 className="card-title">Estatus Operativo (Simulado)</h3>
        <div style={{ height: '220px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-around mt-4">
          {pieData.map(d => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-[10px] font-bold text-slate-500">{d.name}: {d.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 p-6 rounded-3xl shadow-xl text-white">
        <p className="text-[10px] font-bold text-cyan-400 tracking-widest uppercase mb-4">Aviso de Simulación</p>
        <p className="text-xs text-slate-400 leading-relaxed font-bold">
          Este tablero está consumiendo datos del servidor local simulado. Los reportes guardados en la pestaña "Apertura" aparecerán aquí después de refrescar.
        </p>
      </div>
    </div>
  )
}
