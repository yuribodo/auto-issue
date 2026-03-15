import { useState } from 'react'
import type { Run } from '../lib/types'
import { approveRun, rejectRun, openInCursor } from '../lib/ipc'

interface ApprovePanelProps {
  run: Run
  onApproved: () => void
  onRejected: () => void
}

export default function ApprovePanel({ run, onApproved, onRejected }: ApprovePanelProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  if (run.status !== 'awaiting_approval') return null

  async function handleApprove() {
    setLoading('approve')
    try {
      await approveRun(run.id)
      onApproved()
    } finally {
      setLoading(null)
    }
  }

  async function handleRejectClick() {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    setLoading('reject')
    try {
      await rejectRun(run.id, feedback || undefined)
      onRejected()
    } finally {
      setLoading(null)
    }
  }

  const isDisabled = loading !== null

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.indicator} />
        <div style={styles.titleGroup}>
          <div style={styles.title}>Awaiting approval</div>
          <div style={styles.subtitle}>
            Review the changes below, then approve or request changes.
          </div>
        </div>
      </div>

      {/* Quick actions row */}
      <div style={styles.quickActions}>
        {run.pr_url && (
          <button
            style={styles.actionLink}
            onClick={() => window.electronAPI.invoke('shell:open-external', run.pr_url)}
          >
            <span style={styles.actionIcon}>&#8599;</span>
            View PR
          </button>
        )}
        {run.workspace_path && (
          <button
            style={styles.actionLink}
            onClick={() => openInCursor(run.workspace_path!)}
          >
            <span style={styles.actionIcon}>&#9654;</span>
            Open in Cursor
          </button>
        )}
      </div>

      {showFeedback && (
        <textarea
          style={styles.feedbackInput}
          placeholder="Describe what needs to change..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          autoFocus
        />
      )}

      <div style={styles.actions}>
        <button
          style={{
            ...styles.approveBtn,
            opacity: isDisabled ? 0.6 : 1,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
          }}
          onClick={handleApprove}
          disabled={isDisabled}
        >
          {loading === 'approve' && <span style={styles.spinner} />}
          Approve & Merge
        </button>
        <button
          style={{
            ...styles.rejectBtn,
            opacity: isDisabled ? 0.6 : 1,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
          }}
          onClick={handleRejectClick}
          disabled={isDisabled}
        >
          {loading === 'reject' && <span style={styles.spinner} />}
          {showFeedback ? 'Send Feedback' : 'Request Changes'}
        </button>
        {showFeedback && (
          <button
            style={styles.cancelBtn}
            onClick={() => { setShowFeedback(false); setFeedback('') }}
            disabled={isDisabled}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'rgba(0,230,118,0.04)',
    border: '1px solid rgba(0,230,118,0.15)',
    borderRadius: '8px',
    padding: '16px 20px',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '14px',
  },
  indicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--accent)',
    marginTop: '4px',
    flexShrink: 0,
    boxShadow: '0 0 8px rgba(0,230,118,0.4)',
  },
  titleGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--fg)',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
  },
  quickActions: {
    display: 'flex',
    gap: '4px',
    marginBottom: '14px',
  },
  actionLink: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    cursor: 'pointer',
    padding: '5px 10px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    transition: 'all 150ms ease',
  },
  actionIcon: {
    fontSize: '10px',
  },
  feedbackInput: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg)',
    background: 'var(--bg)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    padding: '10px 12px',
    width: '100%',
    resize: 'vertical' as const,
    marginBottom: '12px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  actions: {
    display: 'flex',
    gap: '8px',
  },
  approveBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    letterSpacing: '0.04em',
    padding: '7px 16px',
    borderRadius: '6px',
    border: '1px solid rgba(0,230,118,0.3)',
    background: 'rgba(0,230,118,0.1)',
    color: 'var(--accent)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  rejectBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    letterSpacing: '0.04em',
    padding: '7px 16px',
    borderRadius: '6px',
    border: '1px solid rgba(239,68,68,0.3)',
    background: 'transparent',
    color: '#ef4444',
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  cancelBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    letterSpacing: '0.04em',
    padding: '7px 16px',
    borderRadius: '6px',
    border: '1px solid var(--border-mid)',
    background: 'transparent',
    color: 'var(--fg-muted)',
    fontWeight: 500,
    cursor: 'pointer',
  },
  spinner: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    border: '2px solid transparent',
    borderTopColor: 'currentColor',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },
}
