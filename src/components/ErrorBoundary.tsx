import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    localStorage.clear();
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: '#0f172a',
          color: 'white',
          fontFamily: 'sans-serif'
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#38bdf8' }}>
            Bacheo Toluca: Error de Carga
          </h1>
          <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
            Hubo un problema al arrancar el app en este dispositivo.
          </p>
          <div style={{ 
            backgroundColor: '#1e293b', 
            padding: '1rem', 
            borderRadius: '0.5rem', 
            fontSize: '0.8rem', 
            marginBottom: '2rem',
            textAlign: 'left',
            width: '100%',
            maxWidth: '400px',
            overflowX: 'auto'
          }}>
            <code>{this.state.error?.toString()}</code>
          </div>
          <button 
            onClick={this.handleReset}
            style={{
              backgroundColor: '#00b8a3',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '9999px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Limpiar Cache y Reiniciar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
