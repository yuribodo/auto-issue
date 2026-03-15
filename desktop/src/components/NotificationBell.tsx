import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Notification } from '../lib/types'

const STORAGE_KEY = 'auto-issue-notifications'

function loadNotifications(): Notification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Notification[]) : []
  } catch {
    return []
  }
}

function saveNotifications(notifs: Notification[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifs.slice(0, 50)))
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>(loadNotifications)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const unreadCount = notifications.filter((n) => !n.read).length

  const addNotification = useCallback((notif: Notification) => {
    setNotifications((prev) => {
      const updated = [notif, ...prev]
      saveNotifications(updated)
      return updated
    })
  }, [])

  // Listen for run events
  useEffect(() => {
    const unsub = window.electronAPI.on('run:event', (...args: unknown[]) => {
      const data = args[0] as { runId: string; event: { type: string; prefix: string; content: string } }
      if (!data?.event || data.event.type !== 'status') return

      const { runId, event } = data

      if (event.content.includes('PR detected')) {
        addNotification({
          id: `notif-${Date.now()}`,
          type: 'pr_opened',
          run_id: runId,
          repo: '',
          issue_number: 0,
          message: event.content,
          timestamp: new Date().toISOString(),
          read: false,
        })
      } else if (event.prefix === 'FAIL') {
        addNotification({
          id: `notif-${Date.now()}`,
          type: 'run_failed',
          run_id: runId,
          repo: '',
          issue_number: 0,
          message: `Run failed: ${event.content}`,
          timestamp: new Date().toISOString(),
          read: false,
        })
      } else if (event.content.includes('awaiting_approval')) {
        addNotification({
          id: `notif-${Date.now()}`,
          type: 'approval_needed',
          run_id: runId,
          repo: '',
          issue_number: 0,
          message: 'Run needs your approval',
          timestamp: new Date().toISOString(),
          read: false,
        })
      }
    })
    return unsub
  }, [addNotification])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [open])

  const handleNotifClick = (notif: Notification) => {
    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      saveNotifications(updated)
      return updated
    })
    setOpen(false)
    navigate(`/run/${notif.run_id}`)
  }

  const markAllRead = () => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }))
      saveNotifications(updated)
      return updated
    })
  }

  const formatTime = (timestamp: string) => {
    const ms = Date.now() - new Date(timestamp).getTime()
    const mins = Math.floor(ms / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  const typeColors: Record<string, string> = {
    approval_needed: 'var(--purple)',
    run_failed: 'var(--red)',
    pr_opened: 'var(--blue)',
  }

  const typeLabels: Record<string, string> = {
    approval_needed: 'APPROVAL',
    run_failed: 'FAILED',
    pr_opened: 'PR OPENED',
  }

  return (
    <div ref={ref} style={styles.wrapper}>
      <button style={styles.bellBtn} onClick={() => setOpen((o) => !o)}>
        <span style={styles.bellIcon}>&#9881;</span>
        {unreadCount > 0 && (
          <span style={styles.badge}>{unreadCount}</span>
        )}
      </button>

      {open && (
        <div style={styles.dropdown}>
          <div style={styles.dropdownHeader}>
            <span style={styles.dropdownTitle}>NOTIFICATIONS</span>
            {unreadCount > 0 && (
              <button style={styles.markAllBtn} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          <div style={styles.dropdownBody}>
            {notifications.length === 0 ? (
              <div style={styles.emptyNotif}>No notifications</div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  style={{
                    ...styles.notifItem,
                    background: notif.read ? 'transparent' : 'rgba(0,230,118,0.03)',
                  }}
                  onClick={() => handleNotifClick(notif)}
                >
                  <div style={styles.notifTop}>
                    <span
                      style={{
                        ...styles.notifType,
                        color: typeColors[notif.type],
                        borderColor: typeColors[notif.type],
                      }}
                    >
                      {typeLabels[notif.type]}
                    </span>
                    <span style={styles.notifTime}>{formatTime(notif.timestamp)}</span>
                  </div>
                  <div style={styles.notifMsg}>{notif.message}</div>
                  {!notif.read && <span style={styles.unreadDot} />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
  },
  bellBtn: {
    background: 'none',
    border: 'none',
    padding: '4px',
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  bellIcon: {
    fontSize: '16px',
    color: 'var(--fg-muted)',
  },
  badge: {
    position: 'absolute',
    top: '0',
    right: '-2px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: 'var(--red)',
    color: '#fff',
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdown: {
    position: 'absolute',
    top: '36px',
    right: 0,
    width: '360px',
    background: 'var(--bg2)',
    border: '1px solid var(--border-mid)',
    borderRadius: '8px',
    overflow: 'hidden',
    zIndex: 100,
  },
  dropdownHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border-mid)',
  },
  dropdownTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    color: 'var(--fg-muted)',
  },
  markAllBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--accent)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    letterSpacing: '0.06em',
  },
  dropdownBody: {
    maxHeight: '320px',
    overflowY: 'auto',
  },
  emptyNotif: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    padding: '24px',
    textAlign: 'center',
  },
  notifItem: {
    position: 'relative',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'background 150ms ease',
  },
  notifTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  notifType: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.12em',
    border: '1px solid',
    borderRadius: '3px',
    padding: '1px 5px',
  },
  notifTime: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
  },
  notifMsg: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg)',
    lineHeight: '1.4',
  },
  unreadDot: {
    position: 'absolute',
    top: '14px',
    right: '10px',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'var(--accent)',
  },
}
