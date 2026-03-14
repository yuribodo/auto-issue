import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MOCK_RUNS } from '../lib/mocks'
import type { Run, RunStatus, Provider } from '../lib/types'
import ProviderBadge from '../components/ProviderBadge'

const STATUS_COLORS: Record<RunStatus, string> = {
  queued: 'var(--fg-muted)',
  running: 'var(--amber)',
  awaiting_approval: 'var(--accent)',
  pr_opened: 'var(--blue)',
  done: 'var(--accent)',
  failed: 'var(--red)',
}

const ALL_REPOS = [...new Set(MOCK_RUNS.map((r) => r.repo))]
const ALL_STATUSES: RunStatus[] = ['queued', 'running', 'awaiting_approval', 'done', 'failed']
const ALL_PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini']

export default function History() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filterRepo, setFilterRepo] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterProvider, setFilterProvider] = useState<string>('')

  const filteredRuns = useMemo(() => {
    let runs = [...MOCK_RUNS]

    if (search) {
      const q = search.toLowerCase()
      runs = runs.filter(
        (r) =>
          r.issue_title.toLowerCase().includes(q) ||
          String(r.issue_number).includes(q)
      )
    }
    if (filterRepo) {
      runs = runs.filter((r) => r.repo === filterRepo)
    }
    if (filterStatus) {
      runs = runs.filter((r) => r.status === filterStatus)
    }
    if (filterProvider) {
      runs = runs.filter((r) => r.provider === filterProvider)
    }

    runs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    return runs
  }, [search, filterRepo, filterStatus, filterProvider])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60_000)
    const hrs = Math.floor(mins / 60)
    const days = Math.floor(hrs / 24)

    if (mins < 60) return `${mins}m ago`
    if (hrs < 24) return `${hrs}h ago`
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const clearFilters = () => {
    setSearch('')
    setFilterRepo('')
    setFilterStatus('')
    setFilterProvider('')
  }

  const hasFilters = search || filterRepo || filterStatus || filterProvider

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Run History</h1>
        <span style={styles.count}>{filteredRuns.length} runs</span>
      </div>

      {/* Search */}
      <div style={styles.searchRow}>
        <input
          style={styles.searchInput}
          placeholder="Search by issue title or number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Filters */}
      <div style={styles.filterRow}>
        <select
          style={styles.filterSelect}
          value={filterRepo}
          onChange={(e) => setFilterRepo(e.target.value)}
        >
          <option value="">All repos</option>
          {ALL_REPOS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          style={styles.filterSelect}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ').toUpperCase()}</option>
          ))}
        </select>
        <select
          style={styles.filterSelect}
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
        >
          <option value="">All providers</option>
          {ALL_PROVIDERS.map((p) => (
            <option key={p} value={p}>{p.toUpperCase()}</option>
          ))}
        </select>
        {hasFilters && (
          <button style={styles.clearBtn} onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Run List */}
      <div style={styles.list}>
        {filteredRuns.length === 0 ? (
          <div style={styles.empty}>No runs match your filters</div>
        ) : (
          filteredRuns.map((run) => (
            <RunRow key={run.id} run={run} onClick={() => navigate(`/run/${run.id}`)} formatDate={formatDate} />
          ))
        )}
      </div>
    </div>
  )
}

function RunRow({ run, onClick, formatDate }: { run: Run; onClick: () => void; formatDate: (iso: string) => string }) {
  const [hovered, setHovered] = useState(false)
  const statusColor = STATUS_COLORS[run.status]

  return (
    <div
      style={{
        ...styles.row,
        background: hovered ? 'var(--bg2)' : 'transparent',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.rowLeft}>
        <span style={styles.rowIssue}>#{run.issue_number}</span>
        <span style={styles.rowTitle}>{run.issue_title}</span>
      </div>
      <div style={styles.rowRight}>
        <span style={styles.rowRepo}>{run.repo}</span>
        <ProviderBadge provider={run.provider} model={run.model} />
        <span
          style={{
            ...styles.rowStatus,
            color: statusColor,
            borderColor: statusColor,
          }}
        >
          {run.status.toUpperCase().replace('_', ' ')}
        </span>
        <span style={styles.rowTime}>{formatDate(run.started_at)}</span>
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
    padding: '24px',
    gap: '16px',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '20px',
    fontWeight: 600,
    color: 'var(--fg)',
  },
  count: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.08em',
  },
  searchRow: {
    display: 'flex',
  },
  searchInput: {
    flex: 1,
    maxWidth: '400px',
    padding: '8px 14px',
    background: 'var(--bg2)',
    color: 'var(--fg)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    outline: 'none',
  },
  filterRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  filterSelect: {
    padding: '6px 10px',
    background: 'var(--bg2)',
    color: 'var(--fg)',
    border: '1px solid var(--border-mid)',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    cursor: 'pointer',
    outline: 'none',
  },
  clearBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--accent)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    letterSpacing: '0.06em',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
  },
  empty: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--fg-muted)',
    padding: '48px 0',
    textAlign: 'center',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'background 150ms ease',
    gap: '16px',
  },
  rowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    minWidth: 0,
  },
  rowIssue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--fg)',
    flexShrink: 0,
  },
  rowTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexShrink: 0,
  },
  rowRepo: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.06em',
  },
  rowStatus: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    letterSpacing: '0.12em',
    border: '1px solid',
    borderRadius: '3px',
    padding: '1px 6px',
    whiteSpace: 'nowrap',
  },
  rowTime: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    minWidth: '50px',
    textAlign: 'right' as const,
  },
}
