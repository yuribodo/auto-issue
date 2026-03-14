import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Run } from '../lib/types'
import { getRun } from '../lib/ipc'
import ProviderBadge from '../components/ProviderBadge'
import ApprovePanel from '../components/ApprovePanel'
import AgentTerminal from '../components/AgentTerminal'

const STATUS_COLORS: Record<string, string> = {
  queued: 'var(--fg-muted)',
  running: 'var(--amber)',
  awaiting_approval: 'var(--accent)',
  pr_opened: 'var(--blue)',
  done: 'var(--accent)',
  failed: 'var(--red)',
}

function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(ms / 1000)
  const mins = Math.floor(secs / 60)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) return `${days}d ago`
  if (hrs > 0) return `${hrs}h ago`
  if (mins > 0) return `${mins}m ago`
  return `${secs}s ago`
}

export default function RunDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)

  useEffect(() => {
    if (!id) return
    getRun(id).then(setRun)
  }, [id])

  const refetchRun = () => {
    if (!id) return
    getRun(id).then(setRun)
  }

  if (!run) {
    return (
      <div style={styles.page}>
        <div style={styles.backLink} onClick={() => navigate('/dashboard')}>
          ← Dashboard
        </div>
        <div style={styles.loading}>Loading...</div>
      </div>
    )
  }

  const statusColor = STATUS_COLORS[run.status] ?? 'var(--fg-muted)'

  return (
    <div style={styles.page}>
      {/* Back link */}
      <div style={styles.backLink} onClick={() => navigate('/dashboard')}>
        ← Dashboard
      </div>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <span style={styles.issueNumber}>#{run.issue_number}</span>
          <span
            style={{
              ...styles.statusLabel,
              color: statusColor,
              borderColor: statusColor,
            }}
          >
            {run.status.toUpperCase().replace('_', ' ')}
          </span>
          <ProviderBadge provider={run.provider} model={run.model} />
        </div>
        <div style={styles.issueTitle}>{run.issue_title}</div>
        <div style={styles.meta}>
          <span style={styles.metaItem}>{run.repo}</span>
          <span style={styles.metaSep}>·</span>
          <span style={styles.metaItem}>{run.turns} turns</span>
          <span style={styles.metaSep}>·</span>
          <span style={styles.metaItem}>started {formatRelativeTime(run.started_at)}</span>
        </div>
      </div>

      {/* Approve Panel */}
      {run.status === 'awaiting_approval' && (
        <ApprovePanel run={run} onApproved={refetchRun} onRejected={refetchRun} />
      )}

      {/* Terminal */}
      <div style={styles.terminalWrapper}>
        <AgentTerminal runId={run.id} run={run} />
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--bg)',
    padding: '16px 24px',
    gap: '12px',
  },
  backLink: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    cursor: 'pointer',
    letterSpacing: '0.06em',
    alignSelf: 'flex-start',
  },
  loading: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--fg-muted)',
    padding: '48px 0',
    textAlign: 'center',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  issueNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--fg)',
  },
  statusLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    border: '1px solid',
    borderRadius: '4px',
    padding: '1px 6px',
  },
  issueTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    color: 'var(--fg)',
    fontWeight: 500,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  metaItem: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.06em',
  },
  metaSep: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
  },
  terminalWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
}
