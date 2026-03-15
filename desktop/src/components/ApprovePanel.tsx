import { useState } from 'react'
import type { Run } from '../lib/types'
import { approveRun, rejectRun } from '../lib/ipc'

interface ApprovePanelProps {
  run: Run
  onApproved: () => void
  onRejected: () => void
}

export default function ApprovePanel({ run, onApproved, onRejected }: ApprovePanelProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)

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

  async function handleReject() {
    setLoading('reject')
    try {
      await rejectRun(run.id)
      onRejected()
    } finally {
      setLoading(null)
    }
  }

  const isDisabled = loading !== null

  return (
    <div style={styles.container}>
      <div style={styles.title}>Waiting for your approval</div>
      <div style={styles.subtitle}>Review the pull request before approving or rejecting this run.</div>

      {run.pr_url && (
        <button
          style={styles.prLink}
          onClick={() => window.electronAPI.invoke('shell:open-external', run.pr_url)}
        >
          View PR on GitHub &rarr;
        </button>
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
          Approve
        </button>
        <button
          style={{
            ...styles.rejectBtn,
            opacity: isDisabled ? 0.6 : 1,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
          }}
          onClick={handleReject}
          disabled={isDisabled}
        >
          {loading === 'reject' && <span style={styles.spinner} />}
          Reject
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'rgba(167,139,250,0.06)',
    border: '1px solid rgba(167,139,250,0.2)',
    borderRadius: '8px',
    padding: '20px 24px',
    marginBottom: '16px',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--fg)',
    marginBottom: '6px',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--muted)',
    marginBottom: '14px',
  },
  prLink: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: '#60a5fa',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'inline-block',
    marginBottom: '16px',
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  approveBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    letterSpacing: '0.08em',
    padding: '8px 20px',
    borderRadius: '6px',
    border: 'none',
    background: 'rgba(0,230,118,0.12)',
    color: 'var(--accent)',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  rejectBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    letterSpacing: '0.08em',
    padding: '8px 20px',
    borderRadius: '6px',
    border: '1px solid rgba(239,68,68,0.4)',
    background: 'transparent',
    color: '#ef4444',
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
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
