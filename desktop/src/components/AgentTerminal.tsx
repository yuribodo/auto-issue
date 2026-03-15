import { useState, useEffect, useRef, useCallback } from 'react'
import type { SSEEvent, Run } from '../lib/types'
import { useRunEvents } from '../lib/sse'

interface AgentTerminalProps {
  runId: string
  run?: Run
}

const PREFIX_CONFIG: Record<string, { color: string; icon: string }> = {
  INFO:   { color: 'var(--fg-muted)',  icon: '·' },
  AGENT:  { color: '#c4b5fd',         icon: '▸' },
  INIT:   { color: 'var(--accent)',    icon: '◆' },
  DONE:   { color: 'var(--accent)',    icon: '✓' },
  FAIL:   { color: 'var(--red)',       icon: '✗' },
  PR:     { color: '#60a5fa',          icon: '⎋' },
  WARN:   { color: 'var(--amber)',     icon: '!' },
  ERR:    { color: 'var(--red)',       icon: '✗' },
  OK:     { color: 'var(--accent)',    icon: '✓' },
  // Tool verbs
  READ:   { color: '#94a3b8',         icon: '◇' },
  EDIT:   { color: '#fbbf24',         icon: '◇' },
  WRITE:  { color: '#34d399',         icon: '◇' },
  EXEC:   { color: '#f97316',         icon: '$' },
  FIND:   { color: '#94a3b8',         icon: '◇' },
  SEARCH: { color: '#94a3b8',         icon: '◇' },
  SPAWN:  { color: '#c084fc',         icon: '»' },
  PLAN:   { color: '#94a3b8',         icon: '◇' },
  FETCH:  { color: '#60a5fa',         icon: '↓' },
}

function getConfig(prefix: string) {
  return PREFIX_CONFIG[prefix] ?? { color: 'var(--fg-muted)', icon: '·' }
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const secs = Math.floor(ms / 1000)
  const mins = Math.floor(secs / 60)
  const hrs = Math.floor(mins / 60)
  if (hrs > 0) return `${hrs}h ${mins % 60}m ${secs % 60}s`
  if (mins > 0) return `${mins}m ${secs % 60}s`
  return `${secs}s`
}

export default function AgentTerminal({ runId, run }: AgentTerminalProps) {
  const { events, connected } = useRunEvents(runId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [elapsed, setElapsed] = useState('')
  const prevEventsLen = useRef(0)

  useEffect(() => {
    if (!run?.started_at) return
    const update = () => setElapsed(formatElapsed(run.started_at))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [run?.started_at])

  useEffect(() => {
    if (autoScroll && scrollRef.current && events.length > prevEventsLen.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevEventsLen.current = events.length
  }, [events.length, autoScroll])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 30)
  }, [])

  const resumeScroll = useCallback(() => {
    setAutoScroll(true)
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  const currentTurn = events.filter((e) => e.type === 'turn').length
  const isRunning = run?.status === 'running'
  const issueNum = run?.run_number ?? ''

  return (
    <div style={styles.container}>
      {/* Titlebar */}
      <div style={styles.titlebar}>
        <div style={styles.trafficLights}>
          <span style={{ ...styles.dot, background: '#ff5f57' }} />
          <span style={{ ...styles.dot, background: '#febc2e' }} />
          <span style={{ ...styles.dot, background: '#28c840' }} />
        </div>
        <span style={styles.titleLabel}>
          agent{issueNum ? ` · #${issueNum}` : ''}
        </span>
        {isRunning && <span style={styles.liveIndicator}>LIVE</span>}
      </div>

      {/* Log area */}
      <div style={styles.logArea} ref={scrollRef} onScroll={handleScroll}>
        {events.map((event, i) => (
          <LogLine key={i} event={event} />
        ))}
        {connected && isRunning && <span style={styles.cursor}>_</span>}
      </div>

      {!autoScroll && (
        <button style={styles.pauseBtn} onClick={resumeScroll}>
          &darr; scroll to bottom
        </button>
      )}

      {/* Status bar */}
      <div style={styles.statusBar}>
        {run && (
          <>
            <span
              style={{
                ...styles.statusPill,
                color: STATUS_PILL_COLORS[run.status] ?? 'var(--fg-muted)',
                borderColor: STATUS_PILL_COLORS[run.status] ?? 'var(--fg-muted)',
              }}
            >
              {run.status.toUpperCase().replace('_', ' ')}
            </span>
            <span style={styles.statusDivider}>|</span>
            <span style={styles.statusItem}>turns {currentTurn}</span>
            <span style={styles.statusDivider}>|</span>
            <span style={styles.statusItem}>{run.model}</span>
            <span style={styles.statusDivider}>|</span>
            <span style={styles.statusItem}>{elapsed}</span>
            {run.cost_usd ? (
              <>
                <span style={styles.statusDivider}>|</span>
                <span style={styles.statusItem}>${run.cost_usd.toFixed(2)}</span>
              </>
            ) : null}
          </>
        )}
      </div>

      <style>{keyframes}</style>
    </div>
  )
}

function LogLine({ event }: { event: SSEEvent }) {
  const cfg = getConfig(event.prefix)
  const isTurn = event.type === 'turn'
  const isStatus = event.type === 'status'
  const isAgent = event.prefix === 'AGENT'
  const isExec = event.prefix === 'EXEC'

  return (
    <div
      style={{
        ...styles.logLine,
        ...(isTurn ? styles.logLineTurn : {}),
        ...(isStatus ? styles.logLineStatus : {}),
        animation: 'fadeInLine 150ms ease forwards',
      }}
    >
      <span style={styles.timestamp}>{formatTime(event.timestamp)}</span>
      <span style={{ ...styles.icon, color: cfg.color }}>{cfg.icon}</span>
      <span style={{ ...styles.prefix, color: cfg.color }}>
        {event.prefix.padEnd(6).slice(0, 6)}
      </span>
      <span
        style={{
          ...styles.content,
          ...(isAgent ? styles.contentAgent : {}),
          ...(isExec ? styles.contentExec : {}),
          ...(isStatus && event.prefix === 'DONE' ? styles.contentDone : {}),
          ...(isStatus && event.prefix === 'FAIL' ? styles.contentFail : {}),
          ...(isStatus && event.prefix === 'PR' ? styles.contentPR : {}),
        }}
      >
        {event.content}
      </span>
    </div>
  )
}

const STATUS_PILL_COLORS: Record<string, string> = {
  queued: 'var(--fg-muted)',
  running: 'var(--amber)',
  awaiting_approval: 'var(--accent)',
  pr_opened: 'var(--blue)',
  done: 'var(--accent)',
  failed: 'var(--red)',
}

const keyframes = `
@keyframes fadeInLine {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes pulse-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    background: '#0c0c0c',
    border: '1px solid var(--border-mid)',
    borderRadius: '8px',
    overflow: 'hidden',
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  titlebar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: '#111',
  },
  trafficLights: {
    display: 'flex',
    gap: '6px',
  },
  dot: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  titleLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.08em',
    color: 'rgba(255,255,255,0.35)',
    flex: 1,
  },
  liveIndicator: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.15em',
    color: 'var(--accent)',
    animation: 'pulse-live 2s ease-in-out infinite',
  },
  logArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    minHeight: 0,
  },
  logLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: '1.7',
    padding: '1px 14px',
  },
  logLineTurn: {
    background: 'rgba(255,255,255,0.02)',
    borderLeft: '2px solid rgba(255,255,255,0.06)',
    paddingLeft: '12px',
  },
  logLineStatus: {
    padding: '4px 14px',
    marginTop: '2px',
    marginBottom: '2px',
  },
  timestamp: {
    color: 'rgba(255,255,255,0.18)',
    fontSize: '10px',
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  },
  icon: {
    fontSize: '10px',
    flexShrink: 0,
    width: '10px',
    textAlign: 'center' as const,
  },
  prefix: {
    fontWeight: 600,
    fontSize: '10px',
    flexShrink: 0,
    width: '42px',
    letterSpacing: '0.06em',
  },
  content: {
    color: 'rgba(255,255,255,0.55)',
    wordBreak: 'break-word' as const,
  },
  contentAgent: {
    color: 'rgba(255,255,255,0.85)',
  },
  contentExec: {
    color: '#f97316',
    fontStyle: 'italic' as const,
  },
  contentDone: {
    color: 'var(--accent)',
    fontWeight: 600,
  },
  contentFail: {
    color: 'var(--red)',
    fontWeight: 600,
  },
  contentPR: {
    color: '#60a5fa',
  },
  cursor: {
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    animation: 'blink 1s step-end infinite',
    marginLeft: '82px',
    padding: '1px 14px',
  },
  pauseBtn: {
    position: 'absolute' as const,
    bottom: '44px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.08em',
    background: 'rgba(0,0,0,0.8)',
    color: 'var(--fg-muted)',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    padding: '4px 12px',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 14px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    background: '#111',
  },
  statusPill: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    border: '1px solid',
    borderRadius: '3px',
    padding: '1px 6px',
  },
  statusDivider: {
    color: 'rgba(255,255,255,0.1)',
    fontSize: '10px',
  },
  statusItem: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: '0.04em',
  },
}
