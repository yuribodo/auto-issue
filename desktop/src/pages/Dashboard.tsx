import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Run, User } from '../lib/types'
import { getRuns, getMe } from '../lib/ipc'
import KanbanBoard from '../components/KanbanBoard'
import UserMenu from '../components/UserMenu'

export default function Dashboard() {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    getMe().then(setUser)
  }, [])

  useEffect(() => {
    getRuns().then(setRuns)
    const interval = setInterval(() => {
      getRuns().then(setRuns)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const runningCount = runs ? runs.filter((r) => r.status === 'running').length : 0

  const handleRunClick = (id: string) => {
    navigate(`/runs/${id}`)
  }

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <div style={styles.branding}>
          <span style={styles.bracket}>[</span>
          <span style={styles.brandText}>AUTO-ISSUE</span>
          <span style={styles.bracket}>]</span>
        </div>
        {user && <UserMenu user={user} />}
      </nav>

      <main style={styles.main}>
        <div style={styles.agentCounter}>
          <span style={styles.bracket}>[</span>
          <span style={styles.counterText}>
            {runningCount} / 12 AGENTS RUNNING
          </span>
          <span style={styles.bracket}>]</span>
        </div>

        {runs === null ? (
          <div style={styles.skeletonBoard}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={styles.skeletonCard} />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div style={styles.emptyState}>
            <span>No active runs. Label a GitHub issue with</span>
            <span style={styles.badge}>[ auto-issue ]</span>
          </div>
        ) : (
          <KanbanBoard runs={runs} onRunClick={handleRunClick} />
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    background: 'var(--bg)',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid var(--border)',
  },
  branding: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  bracket: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--fg-muted)',
    fontWeight: 400,
  },
  brandText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--fg)',
    letterSpacing: '0.12em',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    gap: '16px',
  },
  agentCounter: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  counterText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--accent)',
    letterSpacing: '0.12em',
  },
  skeletonBoard: {
    display: 'flex',
    gap: '16px',
  },
  skeletonCard: {
    width: '260px',
    height: '120px',
    background: 'var(--bg3)',
    opacity: 0.5,
    borderRadius: '6px',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '48px 0',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--fg-muted)',
    justifyContent: 'center',
  },
  badge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.08em',
    color: 'var(--accent)',
    background: 'var(--accent-flat)',
    border: '1px solid rgba(0, 230, 118, 0.15)',
    borderRadius: '4px',
    padding: '2px 8px',
  },
}
