import type { InboxAction } from '#/lib/inbox-logic'
import type { StatusDay } from '#/lib/agent-stats'
import { ActivityChart, BarChart, SuccessRate } from '#/components/dashboard/charts'

interface DashboardTabProps {
  latestRun: InboxAction | null
  totals: { total: number; pending: number; approved: number; rejected: number; autoSent: number }
  autoSendRate: number
  approvalRate: number
  avgConfidence: number
  runActivity: { date: string; count: number }[]
  statusBreakdown: StatusDay[]
  confidenceDistribution: { bucket: string; count: number }[]
  successRate: { date: string; rate: number }[]
  recent: InboxAction[]
  onSelectRun: (id: string) => void
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
  const activityBars = normalizeBars(props.runActivity.map((d) => d.count))
  const confMax = Math.max(1, ...props.confidenceDistribution.map((x) => x.count))
  const confBars = props.confidenceDistribution.map((b) => ({
    label: b.bucket,
    height: (b.count / confMax) * 100,
    color: '#3b7ef8',
  }))
  const successPercent = Math.round(
    (props.successRate.reduce((a, r) => a + r.rate, 0) / Math.max(1, props.successRate.length)) * 100,
  )
  const statusMax = Math.max(
    1,
    ...props.statusBreakdown.map((x) => x.pending + x.approved + x.rejected + x.autoSent),
  )
  const statusBars = props.statusBreakdown.map((d) => {
    const total = d.pending + d.approved + d.rejected + d.autoSent
    return {
      label: d.date.slice(5),
      height: total === 0 ? 0 : (total / statusMax) * 100,
      color: '#00c97a',
    }
  })

  return (
    <div className="p-8 overflow-auto flex flex-col gap-6">
      {props.latestRun && (
        <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
          <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>Latest run</p>
          <p className="text-[13px] mb-1" style={{ color: '#e8e6e2' }}>{props.latestRun.customerMsg}</p>
          <p className="text-[11px]" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>
            {props.latestRun.status} · conf {props.latestRun.confidence.toFixed(2)} · {new Date(props.latestRun.createdAt).toLocaleString()}
          </p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <StatTile label="Total runs" value={String(props.totals.total)} sub={`${props.totals.pending} pending`} />
        <StatTile label="Auto-send rate" value={`${Math.round(props.autoSendRate * 100)}%`} />
        <StatTile label="Approval rate" value={`${Math.round(props.approvalRate * 100)}%`} sub={`${props.totals.approved} / ${props.totals.approved + props.totals.rejected}`} />
        <StatTile label="Avg confidence" value={props.avgConfidence.toFixed(2)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ActivityChart bars={activityBars} />
        <BarChart bars={statusBars} title="Status breakdown" />
        <BarChart bars={confBars} title="Confidence distribution" />
        <SuccessRate percent={successPercent} />
      </div>

      <div className="rounded-xl" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <p className="px-4 py-3 text-[10px] uppercase tracking-[0.14em] border-b" style={{ color: '#555', fontFamily: 'var(--font-mono)', borderColor: '#1e1e24' }}>
          Recent runs
        </p>
        {props.recent.length === 0 ? (
          <p className="px-4 py-6 text-[12px]" style={{ color: '#444' }}>No runs yet</p>
        ) : (
          props.recent.map((r) => (
            <button
              key={r.id}
              onClick={() => props.onSelectRun(r.id)}
              className="w-full text-left px-4 py-2.5 border-b flex items-center gap-3 hover:bg-white/5"
              style={{ borderColor: '#1a1a1e' }}
            >
              <span className="text-[10px] w-16 shrink-0" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
              <span className="text-[13px] truncate flex-1" style={{ color: '#c8c5c0' }}>{r.customerMsg}</span>
              <span className="text-[10px] shrink-0" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>{r.status}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
