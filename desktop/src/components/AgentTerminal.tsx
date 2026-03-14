import { useState, useEffect, useRef, useCallback } from 'react'
import type { SSEEvent, Run } from '../lib/types'
import { useMockSSE } from '../lib/sse'

interface AgentTerminalProps {
  runId: string
  run?: Run
}

const PREFIX_COLORS: Record<string, string> = {
  INFO: 'var(--fg-muted)',
  WARN: 'var(--amber)',
  ERR: 'var(--red)',
  OK: 'var(--accent)',
  FAIL: 'var(--red)',
  DONE: 'var(--accent)',
}

function getPrefix4(prefix: string): string {
  if (prefix.length <= 4) return prefix.padEnd(4)
  return prefix.slice(0, 4)
}

function getPrefixColor(prefix: string): string {
  if (prefix.startsWith('T·')) return 'var(--purple)'
  return PREFIX_COLORS[prefix] ?? 'var(--fg-muted)'
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
  const { events, connected } = useMockSSE()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [elapsed, setElapsed] = useState('')
  const prevEventsLen = useRef(0)

  // Live elapsed timer
  useEffect(() => {
    if (!run?.started_at) return
    const update = () => setElapsed(formatElapsed(run.started_at))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [run?.started_at])

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (autoScroll && scrollRef.current && events.length > prevEventsLen.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevEventsLen.current = events.length
  }, [events.length, autoScroll])

  // Detect user scroll up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    setAutoScroll(atBottom)
  }, [])

  const resumeScroll = useCallback(() => {
    setAutoScroll(true)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  const currentTurn = events.filter((e) => e.type === 'turn').length
  const isRunning = run?.status === 'running'
  const issueNum = run?.issue_number ?? ''

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
          [ AGENT LOG{issueNum ? ` · ISSUE #${issueNum}` : ''} ]
        </span>
      </div>

      {/* Log area */}
      <div style={styles.logArea} ref={scrollRef} onScroll={handleScroll}>
        {events.map((event, i) => (
          <LogLine key={i} event={event} isNew={i >= prevEventsLen.current - 1} />
        ))}
        {connected && isRunning && <span style={styles.cursor}>▋</span>}
      </div>

      {/* Pause scroll button */}
      {!autoScroll && (
        <button style={styles.pauseBtn} onClick={resumeScroll}>
          ↓ Resume scroll
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
            <span style={styles.statusItem}>T·{String(currentTurn).padStart(2, '0')}</span>
            <span style={styles.statusItem}>{run.model}</span>
            <span style={styles.statusItem}>{elapsed}</span>
          </>
        )}
        {!run && <span style={styles.statusItem}>—</span>}
      </div>

      <style>{keyframes}</style>
    </div>
  )
}

function LogLine({ event, isNew }: { event: SSEEvent; isNew: boolean }) {
  return (
    <div style={{ ...styles.logLine, animation: isNew ? 'fadeInLine 200ms ease forwards' : undefined }}>
      <span style={styles.timestamp}>{formatTime(event.timestamp)}</span>
      <span style={{ ...styles.prefix, color: getPrefixColor(event.prefix) }}>
        {getPrefix4(event.prefix)}
      </span>
      <span style={styles.content}>{event.content}</span>
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
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
`

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg2)',
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
    borderBottom: '1px solid var(--border-mid)',
    background: 'var(--bg)',
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
    fontSize: '10px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--fg-muted)',
  },
  logArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minHeight: 0,
  },
  logLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  timestamp: {
    color: 'var(--fg-muted)',
    fontSize: '11px',
    flexShrink: 0,
  },
  prefix: {
    fontWeight: 600,
    fontSize: '11px',
    flexShrink: 0,
    width: '36px',
    textAlign: 'right' as const,
  },
  content: {
    color: 'var(--fg)',
  },
  cursor: {
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    animation: 'blink 1s step-end infinite',
    marginLeft: '46px',
  },
  pauseBtn: {
    position: 'absolute' as const,
    bottom: '44px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.08em',
    background: 'var(--bg3)',
    color: 'var(--fg-muted)',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    padding: '4px 12px',
    cursor: 'pointer',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '8px 14px',
    borderTop: '1px solid var(--border-mid)',
    background: 'var(--bg)',
  },
  statusPill: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    border: '1px solid',
    borderRadius: '4px',
    padding: '1px 6px',
  },
  statusItem: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.06em',
  },
}
