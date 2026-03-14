import { useLocation, useNavigate } from 'react-router-dom'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'BOARD', icon: '⊞' },
  { path: '/history', label: 'HISTORY', icon: '⊟' },
  { path: '/analytics', label: 'ANALYTICS', icon: '◈' },
  { path: '/settings', label: 'SETTINGS', icon: '⚙' },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  const isActive = (path: string) => location.pathname === path

  return (
    <aside style={styles.sidebar}>
      <div
        style={styles.branding}
        onClick={() => navigate('/dashboard')}
      >
        <span style={styles.dot} />
        <span style={styles.brandText}>auto-issue</span>
      </div>

      <nav style={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.path}
            style={{
              ...styles.navItem,
              color: isActive(item.path) ? 'var(--accent)' : 'var(--fg-muted)',
              background: isActive(item.path) ? 'var(--accent-flat)' : 'transparent',
              borderColor: isActive(item.path) ? 'rgba(0,230,118,0.15)' : 'transparent',
            }}
            onClick={() => navigate(item.path)}
          >
            <span style={styles.navIcon}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div style={styles.spacer} />

      <div style={styles.version}>
        <span style={styles.bracket}>[</span>
        <span style={styles.versionText}>v0.2.0</span>
        <span style={styles.bracket}>]</span>
      </div>

      <style>{pulseKeyframes}</style>
    </aside>
  )
}

const pulseKeyframes = `
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: '180px',
    minWidth: '180px',
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid var(--border)',
    background: 'var(--bg)',
    padding: '16px 0',
  },
  branding: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 16px 20px',
    cursor: 'pointer',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent)',
    animation: 'pulse-dot 2s ease-in-out infinite',
    flexShrink: 0,
  },
  brandText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--fg)',
    letterSpacing: '0.04em',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '0 8px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    border: '1px solid',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.12em',
    cursor: 'pointer',
    transition: 'all 150ms ease',
    textAlign: 'left' as const,
  },
  navIcon: {
    fontSize: '12px',
    width: '16px',
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  spacer: {
    flex: 1,
  },
  version: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '0 16px',
  },
  bracket: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
  },
  versionText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.06em',
  },
}
