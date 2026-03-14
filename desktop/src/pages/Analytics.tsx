import { useState } from 'react'
import { MOCK_DAILY_STATS_7D, MOCK_DAILY_STATS_30D, MOCK_PROVIDER_STATS, MOCK_REPO_STATS } from '../lib/mocks'
import type { DailyStats } from '../lib/types'

export default function Analytics() {
  const [range, setRange] = useState<'7d' | '30d'>('7d')
  const dailyStats = range === '7d' ? MOCK_DAILY_STATS_7D : MOCK_DAILY_STATS_30D

  const totalRuns = dailyStats.reduce((s, d) => s + d.total, 0)
  const totalSuccess = dailyStats.reduce((s, d) => s + d.success, 0)
  const totalFailed = dailyStats.reduce((s, d) => s + d.failed, 0)
  const successRate = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 0

  const totalCost = MOCK_PROVIDER_STATS.reduce((s, p) => s + p.cost_usd, 0)
  const avgTime = MOCK_PROVIDER_STATS.reduce((s, p) => s + p.avg_time_min * p.runs, 0) /
    MOCK_PROVIDER_STATS.reduce((s, p) => s + p.runs, 0)

  const maxDaily = Math.max(...dailyStats.map((d) => d.total), 1)

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Analytics</h1>
        <div style={styles.rangePicker}>
          <button
            style={{
              ...styles.rangeBtn,
              color: range === '7d' ? 'var(--accent)' : 'var(--fg-muted)',
              borderColor: range === '7d' ? 'var(--accent)' : 'var(--border-mid)',
              background: range === '7d' ? 'var(--accent-flat)' : 'transparent',
            }}
            onClick={() => setRange('7d')}
          >
            7D
          </button>
          <button
            style={{
              ...styles.rangeBtn,
              color: range === '30d' ? 'var(--accent)' : 'var(--fg-muted)',
              borderColor: range === '30d' ? 'var(--accent)' : 'var(--border-mid)',
              background: range === '30d' ? 'var(--accent-flat)' : 'transparent',
            }}
            onClick={() => setRange('30d')}
          >
            30D
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summaryGrid}>
        <MetricCard label="TOTAL RUNS" value={String(totalRuns)} />
        <MetricCard label="SUCCESS RATE" value={`${successRate}%`} color={successRate >= 80 ? 'var(--accent)' : 'var(--amber)'} />
        <MetricCard label="AVG RESOLUTION" value={`${avgTime.toFixed(1)}m`} />
        <MetricCard label="TOTAL COST" value={`$${totalCost.toFixed(2)}`} />
      </div>

      {/* Bar Chart */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>RUNS PER DAY</h2>
        <div style={styles.chart}>
          {dailyStats.map((d, i) => (
            <div key={i} style={styles.barGroup}>
              <div style={styles.barContainer}>
                <div
                  style={{
                    ...styles.barFailed,
                    height: `${(d.failed / maxDaily) * 100}%`,
                  }}
                />
                <div
                  style={{
                    ...styles.barSuccess,
                    height: `${(d.success / maxDaily) * 100}%`,
                  }}
                />
              </div>
              <span style={styles.barLabel}>
                {formatDateLabel(d.date, range === '30d')}
              </span>
            </div>
          ))}
        </div>
        <div style={styles.legend}>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: 'var(--accent)' }} /> Success
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: 'var(--red)' }} /> Failed
          </span>
        </div>
      </div>

      {/* Success Rate Gauge */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>SUCCESS RATE</h2>
        <div style={styles.gaugeRow}>
          <div style={styles.gauge}>
            <div style={styles.gaugeTrack}>
              <div
                style={{
                  ...styles.gaugeFill,
                  width: `${successRate}%`,
                  background: successRate >= 80 ? 'var(--accent)' : successRate >= 60 ? 'var(--amber)' : 'var(--red)',
                }}
              />
            </div>
            <span style={styles.gaugeValue}>{successRate}%</span>
          </div>
          <div style={styles.gaugeStats}>
            <span style={{ ...styles.gaugeStat, color: 'var(--accent)' }}>{totalSuccess} passed</span>
            <span style={{ ...styles.gaugeStat, color: 'var(--red)' }}>{totalFailed} failed</span>
          </div>
        </div>
      </div>

      {/* Provider Stats */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>COST BY PROVIDER</h2>
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span style={{ ...styles.tableCell, flex: 2 }}>PROVIDER</span>
            <span style={styles.tableCell}>RUNS</span>
            <span style={styles.tableCell}>COST</span>
            <span style={styles.tableCell}>AVG TIME</span>
          </div>
          {MOCK_PROVIDER_STATS.map((p) => (
            <div key={p.provider} style={styles.tableRow}>
              <span style={{ ...styles.tableCellValue, flex: 2 }}>
                {p.provider.toUpperCase()}
              </span>
              <span style={styles.tableCellValue}>{p.runs}</span>
              <span style={styles.tableCellValue}>${p.cost_usd.toFixed(2)}</span>
              <span style={styles.tableCellValue}>{p.avg_time_min.toFixed(1)}m</span>
            </div>
          ))}
        </div>
      </div>

      {/* Repo Stats */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>RUNS BY REPOSITORY</h2>
        <div style={styles.repoList}>
          {MOCK_REPO_STATS.map((r) => (
            <div key={r.repo} style={styles.repoItem}>
              <div style={styles.repoTop}>
                <span style={styles.repoName}>{r.repo}</span>
                <span style={styles.repoRuns}>{r.runs} runs</span>
              </div>
              <div style={styles.repoBar}>
                <div
                  style={{
                    ...styles.repoBarFill,
                    width: `${r.success_rate * 100}%`,
                    background: r.success_rate >= 0.8 ? 'var(--accent)' : 'var(--amber)',
                  }}
                />
              </div>
              <span style={styles.repoRate}>{Math.round(r.success_rate * 100)}% success</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={metricStyles.card}>
      <span style={metricStyles.label}>{label}</span>
      <span style={{ ...metricStyles.value, color: color ?? 'var(--fg)' }}>{value}</span>
    </div>
  )
}

function formatDateLabel(dateStr: string, compact: boolean): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (compact) return `${d.getDate()}`
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days[d.getDay()]
}

const metricStyles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '16px',
    background: 'var(--bg2)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    color: 'var(--fg-muted)',
  },
  value: {
    fontFamily: 'var(--font-mono)',
    fontSize: '24px',
    fontWeight: 600,
  },
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: 'var(--bg)',
    padding: '24px',
    gap: '24px',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '20px',
    fontWeight: 600,
    color: 'var(--fg)',
  },
  rangePicker: {
    display: 'flex',
    gap: '4px',
  },
  rangeBtn: {
    padding: '6px 12px',
    border: '1px solid',
    borderRadius: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.1em',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  sectionTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    color: 'var(--fg-muted)',
    fontWeight: 500,
  },
  chart: {
    display: 'flex',
    gap: '4px',
    alignItems: 'flex-end',
    height: '140px',
    padding: '8px 0',
  },
  barGroup: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    height: '100%',
  },
  barContainer: {
    flex: 1,
    width: '100%',
    maxWidth: '24px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    gap: '1px',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  barSuccess: {
    background: 'var(--accent)',
    borderRadius: '2px 2px 0 0',
    transition: 'height 300ms ease',
  },
  barFailed: {
    background: 'var(--red)',
    borderRadius: '2px 2px 0 0',
    transition: 'height 300ms ease',
  },
  barLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    color: 'var(--fg-muted)',
  },
  legend: {
    display: 'flex',
    gap: '16px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
  },
  legendDot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '2px',
  },
  gaugeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  gauge: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  gaugeTrack: {
    flex: 1,
    height: '8px',
    background: 'var(--bg3)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
    borderRadius: '4px',
    transition: 'width 300ms ease',
  },
  gaugeValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '16px',
    fontWeight: 600,
    color: 'var(--fg)',
    minWidth: '44px',
    textAlign: 'right' as const,
  },
  gaugeStats: {
    display: 'flex',
    gap: '12px',
  },
  gaugeStat: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.06em',
  },
  table: {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    padding: '10px 14px',
    background: 'var(--bg2)',
    borderBottom: '1px solid var(--border-mid)',
  },
  tableCell: {
    flex: 1,
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    color: 'var(--fg-muted)',
  },
  tableRow: {
    display: 'flex',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
  },
  tableCellValue: {
    flex: 1,
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--fg)',
  },
  repoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  repoItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '12px 14px',
    background: 'var(--bg2)',
    border: '1px solid var(--border-mid)',
    borderRadius: '6px',
  },
  repoTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  repoName: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--fg)',
  },
  repoRuns: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--fg-muted)',
  },
  repoBar: {
    height: '6px',
    background: 'var(--bg3)',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  repoBarFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 300ms ease',
  },
  repoRate: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--fg-muted)',
    letterSpacing: '0.06em',
  },
}
