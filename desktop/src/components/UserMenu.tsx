import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '../lib/types'

interface UserMenuProps {
  user: User
}

export default function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

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

  const handleSignOut = async () => {
    await window.electronAPI.invoke('auth:logout')
    navigate('/login')
  }

  return (
    <div ref={ref} style={styles.wrapper}>
      <button style={styles.avatarBtn} onClick={() => setOpen((o) => !o)}>
        <img
          src={user.avatar_url}
          alt={user.login}
          style={styles.avatar}
        />
      </button>
      {open && (
        <div style={styles.dropdown}>
          <div style={styles.username}>{user.login}</div>
          <div style={styles.divider} />
          <button style={styles.signOut} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
  },
  avatarBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    borderRadius: '50%',
    display: 'flex',
  },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '1px solid var(--border)',
    objectFit: 'cover',
  },
  dropdown: {
    position: 'absolute',
    top: '36px',
    right: 0,
    background: 'var(--bg2)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    padding: '8px 0',
    minWidth: '160px',
    zIndex: 100,
  },
  username: {
    padding: '6px 14px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.04em',
  },
  divider: {
    height: '1px',
    background: 'var(--border-mid)',
    margin: '4px 0',
  },
  signOut: {
    display: 'block',
    width: '100%',
    padding: '6px 14px',
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg)',
    letterSpacing: '0.04em',
    textAlign: 'left',
    cursor: 'pointer',
  },
}
