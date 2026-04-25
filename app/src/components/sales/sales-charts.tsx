import type { SeriesPoint } from '#/lib/sales-logic'

function formatRM(n: number): string {
  return `RM${n.toFixed(2)}`
}

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl p-4 ${className ?? ''}`}
      style={{ background: '#161618', border: '1px solid #1e1e24' }}
    >
      <p
        className="text-[9px] font-semibold mb-3 tracking-[0.12em] uppercase"
        style={{ color: '#444', fontFamily: 'var(--font-mono)' }}
      >
        {title}
      </p>
      {children}
    </div>
  )
}

function RevenueTrend({ series }: { series: SeriesPoint[] }) {
  const max = Math.max(...series.map((p) => p.revenue), 1)
  const labelStride = Math.max(1, Math.ceil(series.length / 8))
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {series.map((p, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm relative group"
            style={{
              height: `${(p.revenue / max) * 100}%`,
              minHeight: '2px',
              background: 'linear-gradient(to top, #3b7ef8, #3b7ef840)',
            }}
            title={`${p.bucket}: ${formatRM(p.revenue)}`}
          />
        ))}
      </div>
      <div className="flex gap-1 mt-2">
        {series.map((p, i) => (
          <div
            key={i}
            className="flex-1 text-center text-[8px] truncate"
            style={{ color: '#555', fontFamily: 'var(--font-mono)' }}
          >
            {i % labelStride === 0 ? p.bucket : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

function TopProductsList({ items }: { items: Array<{ name: string; revenue: number }> }) {
  if (items.length === 0) {
    return <p className="text-[12px]" style={{ color: '#555' }}>No sales in this range.</p>
  }
  const max = Math.max(...items.map((p) => p.revenue), 1)
  return (
    <div className="space-y-2">
      {items.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-24 text-[11px] truncate" style={{ color: '#aaa' }}>{p.name}</span>
          <div className="flex-1 h-2 rounded-sm overflow-hidden" style={{ background: '#0c0c0f' }}>
            <div
              className="h-full"
              style={{
                width: `${(p.revenue / max) * 100}%`,
                background: 'linear-gradient(to right, #00c97a, #00c97a80)',
              }}
            />
          </div>
          <span className="text-[10px] tabular-nums" style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>
            {formatRM(p.revenue)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function SalesCharts({
  series,
  topProducts,
}: {
  series: SeriesPoint[]
  topProducts: Array<{ name: string; revenue: number }>
}) {
  const empty = series.every((p) => p.revenue === 0)
  return (
    <div className="flex gap-3">
      <ChartCard title="Revenue Trend" className="flex-[3]">
        {empty ? (
          <div className="h-32 flex items-center justify-center text-[12px]" style={{ color: '#555' }}>
            No sales in this range.
          </div>
        ) : (
          <RevenueTrend series={series} />
        )}
      </ChartCard>
      <ChartCard title="Top Products" className="flex-[2]">
        <TopProductsList items={topProducts} />
      </ChartCard>
    </div>
  )
}
