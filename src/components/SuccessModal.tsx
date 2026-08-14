import React from 'react'
import { CheckCircle, FileText, ArrowRight } from 'lucide-react'

interface SuccessModalProps {
  onClose: () => void
  folio?: string
  title?: string
  subtitle?: string
}

export default function SuccessModal({ 
  onClose, 
  folio,
  title = "¡REPORTE GUARDADO!", 
  subtitle = "Información enviada y procesada correctamente" 
}: SuccessModalProps) {
  return (
    <div className="global-modal-overlay">
      <div className="global-modal-content" style={{ maxWidth: '340px' }}>
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} />
        </div>
        
        <h2 className="text-xl font-black text-slate-800 mb-1 uppercase tracking-tight">{title}</h2>
        <p className="text-[11px] text-slate-400 font-bold mb-4 uppercase tracking-wider">{subtitle}</p>

        {folio && (
          <div 
            style={{
              background: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: '20px',
              padding: '1.1rem',
              marginBottom: '1.5rem',
              textAlign: 'center'
            }}
          >
            <span style={{ fontSize: '9px', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: '4px' }}>
              Folio Asignado
            </span>
            <span style={{ fontSize: '1.8rem', fontWeight: 950, color: '#0f172a', letterSpacing: '-0.02em', display: 'block' }}>
              {folio}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 800, color: '#0284c7', display: 'block', marginTop: '6px' }}>
              Disponible en Bitácora para seguimiento
            </span>
          </div>
        )}

        <button 
          className="w-full bg-slate-900 text-white rounded-2xl p-4 font-black uppercase tracking-widest text-[10px] active:scale-95 transition-transform" 
          onClick={onClose}
        >
          ¡ENTENDIDO!
        </button>
      </div>
    </div>
  )
}
