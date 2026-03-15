import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'

export default function Login() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, loading, navigate])

  useEffect(() => {
    const unsubCode = window.electronAPI.on('auth:device-code', (...args: unknown[]) => {
      const data = args[0] as { userCode: string; verificationUri: string }
      setDeviceCode(data.userCode)
      setError(null)
    })
    const unsubError = window.electronAPI.on('auth:error', (...args: unknown[]) => {
      setError(args[0] as string)
      setDeviceCode(null)
    })
    return () => { unsubCode(); unsubError() }
  }, [])

  const handleLogin = () => {
    setDeviceCode(null)
    setError(null)
    window.electronAPI.invoke('auth:login')
  }

  const handleCopy = () => {
    if (deviceCode) {
      navigator.clipboard.writeText(deviceCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoRow}>
          <span style={styles.dot} />
          <span style={styles.logoText}>auto-issue</span>
        </div>

        {!deviceCode && !error && (
          <>
            <p style={styles.subtitle}>Sign in to access your dashboard</p>
            <button style={styles.button} onClick={handleLogin}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span>Sign in with GitHub</span>
            </button>
          </>
        )}

        {deviceCode && (
          <div style={styles.codeSection}>
            <p style={styles.subtitle}>Enter this code on GitHub</p>
            <button style={styles.codeBox} onClick={handleCopy} title="Click to copy">
              {deviceCode}
            </button>
            <p style={styles.hint}>
              {copied ? 'Copied!' : 'Click the code to copy'}
            </p>
            <p style={styles.hint}>
              A browser window has been opened. Paste the code there and authorize the app.
            </p>
            <p style={styles.waiting}>Waiting for authorization...</p>
          </div>
        )}

        {error && (
          <div style={styles.codeSection}>
            <p style={styles.error}>{error}</p>
            <button style={styles.button} onClick={handleLogin}>
              <span>Try again</span>
            </button>
          </div>
        )}
      </div>
      <style>{pulseKeyframes}</style>
    </div>
  )
}

const pulseKeyframes = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'var(--bg)',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent)',
    animation: 'pulse 2s ease-in-out infinite',
  },
  logoText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '28px',
    fontWeight: 500,
    color: 'var(--fg)',
    letterSpacing: '0.04em',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.02em',
    textAlign: 'center',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 24px',
    background: 'var(--accent)',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  codeSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  },
  codeBox: {
    fontFamily: 'var(--font-mono)',
    fontSize: '32px',
    fontWeight: 700,
    letterSpacing: '0.15em',
    color: 'var(--accent)',
    background: 'rgba(0,230,118,0.06)',
    border: '2px solid rgba(0,230,118,0.2)',
    borderRadius: '8px',
    padding: '16px 32px',
    cursor: 'pointer',
    transition: 'border-color 150ms ease',
  },
  hint: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    textAlign: 'center',
    maxWidth: '300px',
  },
  waiting: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    animation: 'pulse 2s ease-in-out infinite',
  },
  error: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: '#ef4444',
    textAlign: 'center',
  },
}
