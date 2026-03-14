import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Run, User } from '../lib/types'
import { getRuns, getMe } from '../lib/ipc'
import KanbanBoard from '../components/KanbanBoard'
import UserMenu from '../components/UserMenu'
import NotificationBell from '../components/NotificationBell'

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
  const todayRuns = runs ? runs.filter((r) => {
    const d = new Date(r.started_at)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  }) : []
  const todaySuccess = todayRuns.filter((r) => r.status === 'done').length
  const todayTotal = todayRuns.length
  const successRate = todayTotal > 0 ? Math.round((todaySuccess / todayTotal) * 100) : 0

  const handleRunClick = (id: string) => {
    navigate(`/run/${id}`)
  }

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <div style={styles.navLeft}>
          {user && <UserMenu user={user} />}
        </div>
        <div style={styles.navRight}>
          <NotificationBell />
        </div>
      </nav>

      <main style={styles.main}>
        {/* Mini Metrics + New Run */}
        <div style={styles.topBar}>
          <div style={styles.metrics}>
            <div style={styles.metric}>
              <span style={styles.bracket}>[</span>
              <span style={styles.metricValue}>
                {runningCount} / 12 AGENTS RUNNING
              </span>
              <span style={styles.bracket}>]</span>
            </div>
            <div style={styles.metric}>
              <span style={styles.bracket}>[</span>
              <span style={styles.metricValue}>
                {successRate}% SUCCESS TODAY
              </span>
              <span style={styles.bracket}>]</span>
            </div>
          </div>
          <button style={styles.newRunBtn} onClick={() => navigate('/create-run')}>
            + New Run
          </button>
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
    height: '100vh',
    background: 'var(--bg)',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderBottom: '1px solid var(--border)',
  },
  navLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  navRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 24px',
    gap: '16px',
    minHeight: 0,
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metrics: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  metric: {
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
  metricValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--accent)',
    letterSpacing: '0.12em',
  },
  newRunBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 16px',
    background: 'var(--accent)',
    color: '#0a0a0a',
    border: 'none',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.04em',
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
