import type React from 'react'
import { ActivityChart, BarChart, SuccessRate } from '#/components/dashboard/charts'
import type { RunRow, RunTotals, RunStatusDay } from '#/lib/agent-run-stats'

interface DashboardTabProps {
  latestRun: RunRow | null
  totals: RunTotals
  cost: { totalUsd: number; totalTokens: number }
  activity: { date: string; count: number }[]
  statusBreakdown: RunStatusDay[]
  avgDurationMs: number
  recent: RunRow[]
  customPanel?: React.ReactNode
  onSelectRun?: (refTable: string, refId: string) => void
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
      <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>{label}</p>
      <p className="text-[22px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>{value}</p>
      {sub && <p className="text-[10px] mt-1" style={{ color: '#444', fontFamily: 'var(--font-mono)' }}>{sub}</p>}
    </div>
  )
}

function normalizeBars(values: number[]): number[] {
  const max = Math.max(1, ...values)
  return values.map((v) => (v / max) * 100)
}

export function DashboardTab(props: DashboardTabProps) {
  const activityBars = normalizeBars(props.activity.map((d) => d.count))
  const totalsForStatus = props.statusBreakdown.map((d) => d.ok + d.failed + d.skipped)
  const statusMax = Math.max(1, ...totalsForStatus)
  const statusBars = props.statusBreakdown.map((d, i) => ({
    label: d.date.slice(5),
    height: totalsForStatus[i] === 0 ? 0 : (totalsForStatus[i] / statusMax) * 100,
    color: '#00c97a',
  }))
  const successPercent = props.totals.runs === 0 ? 0 : Math.round((props.totals.ok / props.totals.runs) * 100)

  return (
    <div className="p-8 overflow-auto flex flex-col gap-6">
      {props.latestRun && (
        <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
          <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>Latest run</p>
          <p className="text-[13px] mb-1" style={{ color: '#e8e6e2' }}>{props.latestRun.summary}</p>
          <p className="text-[11px]" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>
            {props.latestRun.kind} · {props.latestRun.status} · {new Date(props.latestRun.createdAt).toLocaleString()}
          </p>
        </div>
      )}

      {props.customPanel}

      <div className="grid grid-cols-4 gap-3">
        <StatTile label="Total runs" value={String(props.totals.runs)} sub={`${props.totals.failed} failed`} />
        <StatTile label="Success rate" value={`${successPercent}%`} sub={`${props.totals.ok} / ${props.totals.runs}`} />
        <StatTile label="Avg cost" value={props.totals.runs === 0 ? '$0' : `$${(props.cost.totalUsd / props.totals.runs).toFixed(4)}`} sub={`$${props.cost.totalUsd.toFixed(4)} total`} />
        <StatTile label="Avg duration" value={`${props.avgDurationMs} ms`} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ActivityChart bars={activityBars} />
        <BarChart bars={statusBars} title="Run status breakdown" />
        <SuccessRate percent={successPercent} />
      </div>

      <div className="rounded-xl" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <p className="px-4 py-3 text-[10px] uppercase tracking-[0.14em] border-b" style={{ color: '#555', fontFamily: 'var(--font-mono)', borderColor: '#1e1e24' }}>
          Recent runs
        </p>
        {props.recent.length === 0 ? (
          <p className="px-4 py-6 text-[12px]" style={{ color: '#444' }}>No runs yet</p>
        ) : (
          props.recent.map((r) => {
            const clickable = !!(r.refTable && r.refId && props.onSelectRun)
            const Cmp: any = clickable ? 'button' : 'div'
            return (
              <Cmp
                key={r.id}
                {...(clickable ? { onClick: () => props.onSelectRun!(r.refTable!, r.refId!) } : {})}
                className={`w-full text-left px-4 py-2.5 border-b flex items-center gap-3 ${clickable ? 'hover:bg-white/5' : ''}`}
                style={{ borderColor: '#1a1a1e' }}
              >
                <span className="text-[10px] w-16 shrink-0" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
                <span className="text-[13px] truncate flex-1" style={{ color: '#c8c5c0' }}>{r.summary}</span>
                <span className="text-[10px] shrink-0" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>{r.status}</span>
              </Cmp>
            )
          })
        )}
      </div>
    </div>
  )
}
