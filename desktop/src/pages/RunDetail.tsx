import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Run } from '../lib/types'
import { getRun, cancelRun, deleteRun } from '../lib/ipc'
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
    // Poll for status updates while running
    const interval = setInterval(() => {
      getRun(id).then(setRun)
    }, 3000)
    return () => clearInterval(interval)
  }, [id])

  const refetchRun = () => {
    if (!id) return
    getRun(id).then(setRun)
  }

  const handleCancel = async () => {
    if (!id) return
    await cancelRun(id)
    refetchRun()
  }

  const handleDelete = async () => {
    if (!id) return
    await deleteRun(id)
    navigate('/dashboard')
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
          <span style={styles.issueNumber}>#{run.run_number}</span>
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
          {run.status === 'running' && (
            <button style={styles.cancelBtn} onClick={handleCancel}>
              Cancel Run
            </button>
          )}
          {run.status !== 'running' && (
            <button style={styles.deleteBtn} onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
        <div style={styles.issueTitle}>{run.issue_title}</div>
        <div style={styles.meta}>
          <span style={styles.metaItem}>{run.repo}</span>
          <span style={styles.metaSep}>·</span>
          <span style={styles.metaItem}>{run.turns} turns</span>
          <span style={styles.metaSep}>·</span>
          <span style={styles.metaItem}>started {formatRelativeTime(run.started_at)}</span>
          {run.cost_usd !== undefined && (
            <>
              <span style={styles.metaSep}>·</span>
              <span style={styles.metaItem}>${run.cost_usd.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Changes Summary */}
      {(run.files_changed !== undefined || run.pr_url) && (
        <div style={styles.changesBar}>
          {run.files_changed !== undefined && (
            <div style={styles.changesSummary}>
              <span style={styles.changesItem}>
                {run.files_changed} files changed
              </span>
              {run.lines_added !== undefined && (
                <span style={{ ...styles.changesItem, color: 'var(--accent)' }}>
                  +{run.lines_added}
                </span>
              )}
              {run.lines_removed !== undefined && (
                <span style={{ ...styles.changesItem, color: 'var(--red)' }}>
                  -{run.lines_removed}
                </span>
              )}
            </div>
          )}
          {run.pr_url && (
            <a
              href={run.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.viewPrBtn}
            >
              View PR on GitHub →
            </a>
          )}
        </div>
      )}

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
  changesBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: 'var(--bg2)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
  },
  changesSummary: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  changesItem: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg)',
    letterSpacing: '0.04em',
  },
  viewPrBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--blue)',
    textDecoration: 'none',
    letterSpacing: '0.04em',
    padding: '4px 12px',
    border: '1px solid rgba(66,165,245,0.3)',
    borderRadius: '4px',
    transition: 'all 150ms ease',
  },
  cancelBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.08em',
    color: 'var(--red)',
    background: 'transparent',
    border: '1px solid var(--red)',
    borderRadius: '4px',
    padding: '2px 10px',
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  deleteBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.08em',
    color: 'var(--fg-muted)',
    background: 'transparent',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    padding: '2px 10px',
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  terminalWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
}
