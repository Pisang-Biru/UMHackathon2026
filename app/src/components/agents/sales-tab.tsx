import { formatOrderTotal } from '#/lib/order-logic'

type SalesStatus = 'ALL' | 'PAID' | 'PENDING_PAYMENT' | 'CANCELLED'

interface SalesRow {
  id: string
  createdAt: Date
  buyerName: string | null
  productName: string
  qty: number
  totalAmount: number
  status: 'PAID' | 'PENDING_PAYMENT' | 'CANCELLED'
}

interface SalesTabProps {
  totals: { count: number; revenue: number }
  rows: SalesRow[]
  rangeDays: number
  filter: SalesStatus
  onRangeChange: (days: number) => void
  onFilterChange: (status: SalesStatus) => void
}

const RANGES: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: 'All', days: 365 * 100 },
]

const FILTERS: { id: SalesStatus; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PAID', label: 'Paid' },
  { id: 'PENDING_PAYMENT', label: 'Pending' },
  { id: 'CANCELLED', label: 'Cancelled' },
]

export function SalesTab({ totals, rows, rangeDays, filter, onRangeChange, onFilterChange }: SalesTabProps) {
  const shown = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter)
  return (
    <div className="p-8 overflow-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-semibold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>Sales</p>
        <div className="flex gap-1">
          {RANGES.map((r) => {
            const active = r.days === rangeDays
            return (
              <button
                key={r.label}
                onClick={() => onRangeChange(r.days)}
                className="px-2.5 py-1 rounded text-[11px]"
                style={{
                  background: active ? '#1a1a1e' : 'transparent',
                  color: active ? '#e8e6e2' : '#666',
                  border: `1px solid ${active ? '#2a2a32' : '#1a1a1e'}`,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total sales" value={String(totals.count)} />
        <Stat label="Revenue" value={formatOrderTotal(totals.revenue)} />
      </div>

      <div className="flex gap-1.5">
        {FILTERS.map((f) => {
          const active = f.id === filter
          return (
            <button
              key={f.id}
              onClick={() => onFilterChange(f.id)}
              className="px-2.5 py-1 rounded-full text-[11px]"
              style={{
                background: active ? '#1a1a1e' : 'transparent',
                color: active ? '#e8e6e2' : '#666',
                border: `1px solid ${active ? '#2a2a32' : '#1a1a1e'}`,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <div className="grid px-4 py-2.5 border-b text-[10px] uppercase tracking-[0.14em]"
          style={{ borderColor: '#1e1e24', color: '#555', fontFamily: 'var(--font-mono)', gridTemplateColumns: '90px 1fr 1fr 60px 90px 90px' }}
        >
          <span>Date</span>
          <span>Buyer</span>
          <span>Product</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Total</span>
          <span className="text-right">Status</span>
        </div>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-[12px]" style={{ color: '#444' }}>No sales</p>
        ) : (
          shown.map((r) => (
            <div
              key={r.id}
              className="grid px-4 py-2.5 border-b text-[12px]"
              style={{ borderColor: '#1a1a1e', gridTemplateColumns: '90px 1fr 1fr 60px 90px 90px' }}
            >
              <span style={{ color: '#888' }}>{new Date(r.createdAt).toLocaleDateString()}</span>
              <span style={{ color: '#c8c5c0' }}>{r.buyerName ?? '—'}</span>
              <span style={{ color: '#c8c5c0' }}>{r.productName}</span>
              <span className="text-right" style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{r.qty}</span>
              <span className="text-right" style={{ color: '#c8c5c0', fontFamily: 'var(--font-mono)' }}>{formatOrderTotal(r.totalAmount)}</span>
              <span className="text-right" style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{r.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
      <p className="text-[10px] uppercase tracking-[0.14em] mb-2" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>{label}</p>
      <p className="text-[22px] font-bold" style={{ color: '#f0ede8', fontFamily: 'var(--font-display)' }}>{value}</p>
    </div>
  )
}
