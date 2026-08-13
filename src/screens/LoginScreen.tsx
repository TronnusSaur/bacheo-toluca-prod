import React, { useState } from 'react'
import { LogIn, AlertCircle, Shield } from 'lucide-react'
import { signIn } from '../lib/supabase'
import './LoginScreen.css'

interface LoginScreenProps {
  onLoginSuccess: () => void
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    
    setLoading(true)
    setError(null)

    try {
      await signIn(email.trim(), password)
      onLoginSuccess()
    } catch (err: any) {
      console.error('[LOGIN ERROR]', err)
      setError(err.message || 'Error de autenticación con Supabase')
    } finally {
      setLoading(false)
    }
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

        {/* Error Banner */}
        {error && (
          <div className="login-error">
            <AlertCircle size={14} />
            <span>{error}</span>
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
            ) : (
              <LogIn size={18} />
            )}
            {loading ? 'VERIFICANDO...' : 'INGRESAR AL SISTEMA'}
          </button>
        </form>

        {/* Footer */}
        <p className="login-footer">
          Acceso exclusivo para personal autorizado de supervisión
        </p>
      </div>
    </div>
  )
}
