import React, { useState } from 'react'
import { LogIn, AlertCircle, Shield, UserPlus, Zap } from 'lucide-react'
import { signIn, signUp, setDemoSession } from '../lib/supabase'
import './LoginScreen.css'

interface LoginScreenProps {
  onLoginSuccess: () => void
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('juanpablobumblebee@gmail.com')
  const [password, setPassword] = useState('')
  const [isSignUpMode, setIsSignUpMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    
    setLoading(true)
    setError(null)
    setSuccessMsg(null)

    try {
      if (isSignUpMode) {
        await signUp(email.trim(), password)
        setSuccessMsg('Cuenta creada correctamente. Intenta ingresar o usa el Modo Pruebas.')
        setIsSignUpMode(false)
      } else {
        await signIn(email.trim(), password)
        onLoginSuccess()
      }
    } catch (err: any) {
      console.error('[AUTH ERROR]', err)
      const msg = err.message || 'Error de autenticación'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleDemoLogin = () => {
    setDemoSession(email.trim() || 'juanpablobumblebee@gmail.com')
    onLoginSuccess()
    window.location.reload()
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        {/* Logo Section */}
        <div className="login-header">
          <div className="login-icon-ring">
            <Shield size={32} />
          </div>
          <h1 className="login-title">Bacheo <span className="login-accent">Toluca</span></h1>
          <p className="login-subtitle">SISTEMA DE SUPERVISIÓN EN CAMPO (SUPABASE)</p>
        </div>

        {/* Success Banner */}
        {successMsg && (
          <div style={{ background: '#ecfdf5', color: '#047857', padding: '0.75rem 1rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '1rem', border: '1px solid #a7f3d0' }}>
            {successMsg}
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="login-error flex flex-col gap-2">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>

            {(error.includes('Email not confirmed') || error.includes('Invalid login')) && (
              <button 
                type="button" 
                onClick={handleDemoLogin}
                style={{
                  marginTop: '0.5rem',
                  background: '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '0.75rem',
                  padding: '0.6rem 1rem',
                  fontSize: '0.75rem',
                  fontWeight: 900,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  width: '100%'
                }}
              >
                <Zap size={14} /> ENTRAR EN MODO PRUEBAS / DEMO
              </button>
            )}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="login-email">Correo Institucional</label>
            <input
              id="login-email"
              type="email"
              placeholder="supervisor@bacheo.gob.mx"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <button 
            type="submit" 
            className="login-btn"
            disabled={loading || !email || !password}
          >
            {loading ? (
              <span className="login-spinner" />
            ) : isSignUpMode ? (
              <UserPlus size={18} />
            ) : (
              <LogIn size={18} />
            )}
            {loading ? 'PROCESANDO...' : (isSignUpMode ? 'CREAR CUENTA SUPABASE' : 'INGRESAR AL SISTEMA')}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setIsSignUpMode(!isSignUpMode)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: '#0284c7',
                fontSize: '0.7rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              {isSignUpMode ? '← Volver a Iniciar Sesión' : '¿No tienes cuenta? Registrarse'}
            </button>

            <button
              type="button"
              onClick={handleDemoLogin}
              style={{
                background: '#f1f5f9',
                border: 'none',
                color: '#475569',
                borderRadius: '0.5rem',
                padding: '0.3rem 0.6rem',
                fontSize: '0.65rem',
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
            >
              <Zap size={12} className="text-sky-500" /> Modo Pruebas
            </button>
          </div>
        </form>

        {/* Footer */}
        <p className="login-footer">
          Acceso para personal de supervisión (Supabase Direct Sync)
        </p>
      </div>
    </div>
  )
}
