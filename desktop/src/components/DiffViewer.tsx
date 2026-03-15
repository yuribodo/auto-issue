import { useState, useEffect } from 'react'
import { getRunDiff } from '../lib/ipc'

interface DiffFile {
  path: string
  status: string
  additions: number
  deletions: number
  patch: string
}

interface DiffData {
  files: DiffFile[]
  summary: {
    files_changed: number
    lines_added: number
    lines_removed: number
  }
}

interface DiffViewerProps {
  runId: string
}

export default function DiffViewer({ runId }: DiffViewerProps) {
  const [diff, setDiff] = useState<DiffData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    setError(null)
    getRunDiff(runId)
      .then((data) => {
        setDiff(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to load diff')
        setLoading(false)
      })
  }, [runId])

  function toggleFile(path: string) {
    setExpandedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  function expandAll() {
    if (!diff) return
    setExpandedFiles(new Set(diff.files.map((f) => f.path)))
  }

  function collapseAll() {
    setExpandedFiles(new Set())
  }

  if (loading) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>...</div>
        <div style={styles.emptyText}>Loading changes</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>!</div>
        <div style={styles.emptyText}>{error}</div>
      </div>
    )
  }

  if (!diff || diff.files.length === 0) {
    return (
      <div style={styles.emptyState}>
        <div style={styles.emptyIcon}>~</div>
        <div style={styles.emptyText}>No changes</div>
      </div>
    )
  }

  const allExpanded = expandedFiles.size === diff.files.length

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <div style={styles.headerBar}>
        <div style={styles.statsRow}>
          <span style={styles.statLabel}>{diff.summary.files_changed} files</span>
          <span style={styles.statAdded}>+{diff.summary.lines_added}</span>
          <span style={styles.statRemoved}>-{diff.summary.lines_removed}</span>
        </div>
        <button
          style={styles.toggleAllBtn}
          onClick={allExpanded ? collapseAll : expandAll}
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {/* File list */}
      <div style={styles.fileList}>
        {diff.files.map((file) => {
          const isExpanded = expandedFiles.has(file.path)
          const total = file.additions + file.deletions
          const addPct = total > 0 ? (file.additions / total) * 100 : 0

          return (
            <div key={file.path} style={styles.fileEntry}>
              <div
                style={{
                  ...styles.fileHeader,
                  borderBottomLeftRadius: isExpanded ? 0 : undefined,
                  borderBottomRightRadius: isExpanded ? 0 : undefined,
                }}
                onClick={() => toggleFile(file.path)}
              >
                <span style={styles.expandIcon}>
                  {isExpanded ? '\u25BE' : '\u25B8'}
                </span>

                {/* Status badge */}
                <span style={statusBadgeStyle(file.status)}>
                  {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                </span>

                {/* File path — show directory dimmed, filename bright */}
                <span style={styles.filePath}>
                  {file.path.includes('/') && (
                    <span style={styles.fileDir}>
                      {file.path.substring(0, file.path.lastIndexOf('/') + 1)}
                    </span>
                  )}
                  <span style={styles.fileName}>
                    {file.path.includes('/')
                      ? file.path.substring(file.path.lastIndexOf('/') + 1)
                      : file.path}
                  </span>
                </span>

                {/* Mini bar chart + counts */}
                <span style={styles.fileStatsGroup}>
                  <span style={styles.miniBar}>
                    <span
                      style={{
                        ...styles.miniBarFill,
                        width: `${addPct}%`,
                        background: '#4ade80',
                      }}
                    />
                    <span
                      style={{
                        ...styles.miniBarFill,
                        width: `${100 - addPct}%`,
                        background: '#f87171',
                      }}
                    />
                  </span>
                  <span style={styles.statCount}>
                    <span style={{ color: '#4ade80' }}>+{file.additions}</span>
                    <span style={{ color: '#f87171' }}>-{file.deletions}</span>
                  </span>
                </span>
              </div>

              {isExpanded && (
                <div style={styles.patchContainer}>
                  <pre style={styles.patch}>
                    {file.patch.split('\n').map((line, i) => {
                      let color = 'var(--fg-muted)'
                      let bg = 'transparent'
                      let borderLeft = '3px solid transparent'

                      if (line.startsWith('+') && !line.startsWith('+++')) {
                        color = '#bbf7d0'
                        bg = 'rgba(74,222,128,0.06)'
                        borderLeft = '3px solid #4ade80'
                      } else if (line.startsWith('-') && !line.startsWith('---')) {
                        color = '#fecaca'
                        bg = 'rgba(248,113,113,0.06)'
                        borderLeft = '3px solid #f87171'
                      } else if (line.startsWith('@@')) {
                        color = '#93c5fd'
                        bg = 'rgba(96,165,250,0.06)'
                      } else if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
                        color = 'var(--fg-muted)'
                        bg = 'rgba(255,255,255,0.02)'
                      }

                      return (
                        <div
                          key={i}
                          style={{
                            color,
                            background: bg,
                            borderLeft,
                            padding: '0 12px 0 8px',
                            minHeight: '20px',
                            lineHeight: '20px',
                          }}
                        >
                          {line || ' '}
                        </div>
                      )
                    })}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const colors = {
    added: { bg: 'rgba(74,222,128,0.12)', fg: '#4ade80' },
    deleted: { bg: 'rgba(248,113,113,0.12)', fg: '#f87171' },
    modified: { bg: 'rgba(96,165,250,0.12)', fg: '#60a5fa' },
  }
  const c = colors[status as keyof typeof colors] || colors.modified

  return {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    fontWeight: 700,
    width: '18px',
    height: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    background: c.bg,
    color: c.fg,
    flexShrink: 0,
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'auto',
    gap: '0',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '48px 24px',
    height: '100%',
  },
  emptyIcon: {
    fontFamily: 'var(--font-mono)',
    fontSize: '24px',
    color: 'var(--fg-muted)',
    opacity: 0.4,
  },
  emptyText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg-muted)',
  },
  headerBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: 'var(--bg2)',
    borderBottom: '1px solid var(--border-mid)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  },
  statsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
  },
  statLabel: {
    color: 'var(--fg-muted)',
  },
  statAdded: {
    color: '#4ade80',
  },
  statRemoved: {
    color: '#f87171',
  },
  toggleAllBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
  },
  fileEntry: {
    borderBottom: '1px solid var(--border-mid)',
  },
  fileHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '7px 12px',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg)',
    background: 'var(--bg)',
    transition: 'background 100ms ease',
  },
  expandIcon: {
    fontSize: '10px',
    color: 'var(--fg-muted)',
    width: '10px',
    flexShrink: 0,
  },
  filePath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '12px',
  },
  fileDir: {
    color: 'var(--fg-muted)',
  },
  fileName: {
    color: 'var(--fg)',
  },
  fileStatsGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  miniBar: {
    display: 'flex',
    width: '40px',
    height: '4px',
    borderRadius: '2px',
    overflow: 'hidden',
    background: 'var(--border-mid)',
  },
  miniBarFill: {
    height: '100%',
  },
  statCount: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    display: 'flex',
    gap: '6px',
    width: '60px',
    justifyContent: 'flex-end',
  },
  patchContainer: {
    borderTop: '1px solid var(--border-mid)',
    maxHeight: '500px',
    overflow: 'auto',
  },
  patch: {
    margin: 0,
    padding: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    lineHeight: '20px',
    overflow: 'visible',
    background: 'var(--bg)',
    tabSize: 4,
  },
}
