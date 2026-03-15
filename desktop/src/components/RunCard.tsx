import { useState, useEffect } from 'react'
import type { Run, RunStatus } from '../lib/types'
import ProviderBadge from './ProviderBadge'

interface RunCardProps {
  run: Run
  onClick: () => void
}

const STATUS_COLORS: Record<RunStatus, string> = {
  queued: 'var(--fg-muted)',
  running: 'var(--amber)',
  awaiting_approval: 'var(--accent)',
  pr_opened: 'var(--blue)',
  done: 'var(--accent)',
  failed: 'var(--red)',
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const secs = Math.floor(ms / 1000)
  const mins = Math.floor(secs / 60)
  const hrs = Math.floor(mins / 60)
  if (hrs > 0) return `${hrs}h ${mins % 60}m`
  if (mins > 0) return `${mins}m ${secs % 60}s`
  return `${secs}s`
}

export default function RunCard({ run, onClick }: RunCardProps) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(run.started_at))
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (run.status !== 'running') {
      setElapsed(formatElapsed(run.started_at))
      return
    }
    const id = setInterval(() => setElapsed(formatElapsed(run.started_at)), 1000)
    return () => clearInterval(id)
  }, [run.status, run.started_at])

  const borderColor = STATUS_COLORS[run.status]
  const statusColor = STATUS_COLORS[run.status]

  const testBadge = run.test_result
    ? run.test_result === 'passed'
      ? { symbol: '✓', color: 'var(--accent)' }
      : { symbol: '✗', color: 'var(--red)' }
    : null

  return (
    <div
      style={{
        ...styles.card,
        borderLeftColor: borderColor,
        background: hovered ? 'var(--bg2)' : 'var(--bg)',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {run.status === 'running' && (
        <div style={styles.scannerLine} />
      )}
      <div style={styles.header}>
        <span style={styles.label}>#{run.run_number}</span>
        <ProviderBadge provider={run.provider} model={run.model} />
        <span style={{ ...styles.statusLabel, color: statusColor, borderColor: statusColor }}>
          [ {run.status.toUpperCase().replace('_', ' ')} ]
        </span>
      </div>
      <div style={styles.title}>{run.issue_title}</div>
      <div style={styles.footer}>
        <span style={styles.label}>{run.turns} turns</span>
        <span style={styles.label}>{elapsed}</span>
        {testBadge && (
          <span style={{ ...styles.label, color: testBadge.color }}>
            {testBadge.symbol} tests
          </span>
        )}
        {!testBadge && (
          <span style={{ ...styles.label, color: 'var(--fg-muted)' }}>— tests</span>
        )}
      </div>
      {run.status === 'running' && <style>{scannerKeyframes}</style>}
    </div>
  )
}

const scannerKeyframes = `
@keyframes scanner {
  0% { top: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { top: calc(100% - 2px); opacity: 0; }
}
`

const styles: Record<string, React.CSSProperties> = {
  card: {
    position: 'relative',
    overflow: 'hidden',
    padding: '12px 14px',
    borderLeft: '1px solid',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background 150ms ease',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  scannerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '2px',
    background: 'var(--amber)',
    opacity: 0.4,
    animation: 'scanner 2s ease-in-out infinite',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  statusLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    whiteSpace: 'nowrap',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--fg)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--fg-muted)',
    whiteSpace: 'nowrap',
  },
}
