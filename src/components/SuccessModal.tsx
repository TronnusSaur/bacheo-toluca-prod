import { CheckCircle } from 'lucide-react'

interface SuccessModalProps {
  onClose: () => void
  title?: string
  subtitle?: string
}

export default function SuccessModal({ 
  onClose, 
  title = "¡SINCRO EXITOSA!", 
  subtitle = "Información enviada correctamente" 
}: SuccessModalProps) {
  return (
    <div className="global-modal-overlay">
      <div className="global-modal-content">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={32} />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2 uppercase tracking-tight">{title}</h2>
        <p className="text-xs text-slate-400 font-bold mb-8 uppercase tracking-widest">{subtitle}</p>
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
