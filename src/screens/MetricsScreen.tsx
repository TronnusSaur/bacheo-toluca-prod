import React, { useState, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { LayoutDashboard } from 'lucide-react'
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
      
      if (Array.isArray(data)) {
        const totalM2 = data.reduce((acc: number, r: any) => acc + (parseFloat(r.m2) || 0), 0)
        const completed = data.filter((r: any) => r.status === 'TERMINADO').length
        const pending = data.length - completed
        
        setStats({
          total: data.length,
          m2: parseFloat(totalM2.toFixed(1)),
          completed,
          pending
        })
      }
    } catch (err) {
      console.error('[METRICAS ERROR] No se pudieron cargar los datos.')
    }
  }

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 10000)
    return () => clearInterval(interval)
  }, [])

  const pieData = [
    { name: 'Pendientes', value: stats.pending, color: '#f59e0b' },
    { name: 'Terminados', value: stats.completed, color: '#00b8a3' },
  ]

  return (
    <div className="metrics-container p-6 animate-in">
      <div className="mb-8">
        <h1 className="metrics-title">Centro de Control</h1>
        <p className="text-[10px] font-black text-cyan-600 tracking-widest uppercase mt-1">
          Estatus Operativo en Tiempo Real
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="nordic-card">
          <h3 className="card-title">Baches Registrados</h3>
          <div className="huge-number">{stats.total}</div>
        </div>
        <div className="nordic-card">
          <h3 className="card-title">M² Totales</h3>
          <div className="huge-number teal">{stats.m2}</div>
        </div>
      </div>

      <div className="nordic-card mb-6">
        <h3 className="card-title">Distribución de Avance</h3>
        <div style={{ height: '220px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={65}
                outerRadius={85}
                paddingAngle={8}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} cornerRadius={10} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '10px', fontWeight: 'bold' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-around mt-4">
          {pieData.map(d => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
              <div className="flex flex-col">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">{d.name}</span>
                <span className="text-sm font-black text-slate-700">{d.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 p-6 rounded-[32px] shadow-2xl text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <LayoutDashboard size={48} />
        </div>
        <p className="text-[10px] font-black text-cyan-400 tracking-widest uppercase mb-4">Información del Sistema</p>
        <p className="text-[11px] text-slate-400 leading-relaxed font-bold">
          Este tablero refleja el progreso consolidado de todas las cuadrillas en campo. Los datos se actualizan automáticamente cada 10 segundos.
        </p>
      </div>
    </div>
  )
}
