import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Run } from '../lib/types'
import { getRun, cancelRun, deleteRun, openInCursor } from '../lib/ipc'
import ProviderBadge from '../components/ProviderBadge'
import ApprovePanel from '../components/ApprovePanel'
import AgentTerminal from '../components/AgentTerminal'
import DiffViewer from '../components/DiffViewer'

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

type Tab = 'terminal' | 'changes'

export default function RunDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('terminal')

  const showTabs = run && run.workspace_path && (
    run.status === 'awaiting_approval' || run.status === 'done'
  )

  useEffect(() => {
    if (!id) return
    getRun(id).then(setRun)
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
          &larr; Dashboard
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
        &larr; Dashboard
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

          {/* Right-aligned actions */}
          <div style={styles.headerActions}>
            {run.workspace_path && (
              <button
                style={styles.headerActionBtn}
                onClick={() => openInCursor(run.workspace_path!)}
              >
                Open in Cursor
              </button>
            )}
            {run.pr_url && (
              <button
                style={styles.headerActionBtn}
                onClick={() => window.electronAPI.invoke('shell:open-external', run.pr_url)}
              >
                View PR
              </button>
            )}
            {run.status === 'running' ? (
              <button style={styles.cancelBtn} onClick={handleCancel}>
                Cancel
              </button>
            ) : (
              <button style={styles.deleteBtn} onClick={handleDelete}>
                Delete
              </button>
            )}
          </div>
        </div>
        <div style={styles.issueTitle}>{run.issue_title}</div>
        <div style={styles.meta}>
          <span style={styles.metaItem}>{run.repo}</span>
          <span style={styles.metaSep}>&middot;</span>
          <span style={styles.metaItem}>{run.turns} turns</span>
          <span style={styles.metaSep}>&middot;</span>
          <span style={styles.metaItem}>started {formatRelativeTime(run.started_at)}</span>
          {run.cost_usd !== undefined && (
            <>
              <span style={styles.metaSep}>&middot;</span>
              <span style={styles.metaItem}>${run.cost_usd.toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Approve Panel */}
      {run.status === 'awaiting_approval' && (
        <ApprovePanel run={run} onApproved={refetchRun} onRejected={refetchRun} />
      )}

      {/* Tab bar — only when there are changes to show */}
      {showTabs && (
        <div style={styles.tabBar}>
          {(['terminal', 'changes'] as Tab[]).map((tab) => (
            <button
              key={tab}
              style={{
                ...styles.tab,
                ...(activeTab === tab ? styles.tabActive : {}),
              }}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'terminal' ? 'Terminal' : 'Changes'}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div style={styles.contentWrapper}>
        {showTabs && activeTab === 'changes' ? (
          <DiffViewer runId={run.id} />
        ) : (
          <AgentTerminal runId={run.id} run={run} />
        )}
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
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginLeft: 'auto',
  },
  headerActionBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.06em',
    color: 'var(--fg-muted)',
    background: 'transparent',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    padding: '3px 10px',
    cursor: 'pointer',
    transition: 'all 150ms ease',
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
  cancelBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.08em',
    color: 'var(--red)',
    background: 'transparent',
    border: '1px solid var(--red)',
    borderRadius: '4px',
    padding: '3px 10px',
    cursor: 'pointer',
  },
  deleteBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.08em',
    color: 'var(--fg-muted)',
    background: 'transparent',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    padding: '3px 10px',
    cursor: 'pointer',
  },
  tabBar: {
    display: 'flex',
    gap: '0',
    borderBottom: '1px solid var(--border-mid)',
    marginBottom: '-12px',
  },
  tab: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    padding: '8px 14px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'var(--fg-muted)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
  tabActive: {
    color: 'var(--fg)',
    borderBottomColor: 'var(--accent)',
  },
  contentWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderRadius: '6px',
    overflow: 'hidden',
    border: '1px solid var(--border-mid)',
  },
}
