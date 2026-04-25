import type { SalesKpis } from '#/lib/sales-logic'

function formatRM(n: number): string {
  return `RM${n.toFixed(2)}`
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-xl p-4 flex-1 min-w-0"
      style={{ background: '#161618', border: '1px solid #1e1e24' }}
    >
      <p
        className="text-[9px] font-semibold mb-2 tracking-[0.12em] uppercase"
        style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </p>
      <p
        className="text-[22px] font-bold tracking-tight truncate"
        style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[11px] mt-1 truncate" style={{ color: '#888' }}>{sub}</p>
      )}
    </div>
  )
}

export function KpiCards({ kpis }: { kpis: SalesKpis }) {
  return (
    <div className="flex gap-3">
      <Card label="Revenue" value={formatRM(kpis.revenue)} />
      <Card label="Orders" value={String(kpis.orderCount)} />
      <Card label="Avg Order Value" value={formatRM(kpis.avgOrderValue)} />
      <Card
        label="Top Product"
        value={kpis.topProduct ? kpis.topProduct.name : '—'}
        sub={kpis.topProduct ? formatRM(kpis.topProduct.revenue) : undefined}
      />
    </div>
  )
}
