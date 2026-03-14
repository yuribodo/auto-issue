import type { Run, RunStatus } from '../lib/types'
import RunCard from './RunCard'

interface KanbanBoardProps {
  runs: Run[]
  onRunClick: (id: string) => void
}

interface Column {
  key: string
  label: string
  statuses: RunStatus[]
}

const COLUMNS: Column[] = [
  { key: 'queued', label: 'Queued', statuses: ['queued'] },
  { key: 'running', label: 'Running', statuses: ['running'] },
  { key: 'awaiting', label: 'Awaiting Approval', statuses: ['awaiting_approval'] },
  { key: 'done', label: 'Done', statuses: ['pr_opened', 'done'] },
  { key: 'failed', label: 'Failed', statuses: ['failed'] },
]

export default function KanbanBoard({ runs, onRunClick }: KanbanBoardProps) {
  return (
    <div style={styles.board}>
      {COLUMNS.map((col) => {
        const columnRuns = runs.filter((r) => col.statuses.includes(r.status))
        return (
          <div key={col.key} style={styles.column}>
            <div style={styles.columnHeader}>
              <span style={styles.columnLabel}>{col.label}</span>
              <span style={styles.count}>({columnRuns.length})</span>
            </div>
            <div style={styles.columnBody}>
              {columnRuns.length === 0 ? (
                <span style={styles.empty}>No runs</span>
              ) : (
                columnRuns.map((run) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    onClick={() => onRunClick(run.id)}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  board: {
    display: 'flex',
    gap: '16px',
    overflowX: 'auto',
    padding: '4px 0',
    minHeight: 0,
    flex: 1,
  },
  column: {
    minWidth: '260px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  columnHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 4px 8px',
    borderBottom: '1px solid var(--border)',
  },
  columnLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--fg-muted)',
  },
  count: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
  },
  columnBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1,
  },
  empty: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
    padding: '16px 4px',
  },
}
