import React from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react'
import type { SalesOrder } from '#/lib/sales-logic'
import { MarginBadge } from '#/components/MarginBadge'

type SortDir = 'asc' | 'desc' | null
type SortKey = 'createdAt' | 'productName' | 'qty' | 'unitPrice' | 'totalAmount' | 'buyerName' | 'paidAt'

function formatRM(n: number): string {
  return `RM${n.toFixed(2)}`
}

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-MY', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function compareBy(key: SortKey, dir: 'asc' | 'desc') {
  return (a: SalesOrder, b: SalesOrder) => {
    const av = a[key]
    const bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (av instanceof Date && bv instanceof Date) {
      return dir === 'asc' ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime()
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av
    }
    const as = String(av), bs = String(bv)
    return dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
  }
}

export function useDisplayedSales(orders: SalesOrder[], search: string, sortKey: SortKey | null, sortDir: SortDir) {
  return React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q === '' ? orders : orders.filter((o) =>
      (o.buyerName ?? '').toLowerCase().includes(q) ||
      o.productName.toLowerCase().includes(q)
    )
    if (!sortKey || !sortDir) return filtered
    return [...filtered].sort(compareBy(sortKey, sortDir))
  }, [orders, search, sortKey, sortDir])
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'left' | 'right'
}) {
  const Icon = !active || !dir ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] cursor-pointer select-none ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: '#666', fontFamily: 'var(--font-mono)' }}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon size={10} style={{ color: active ? '#3b7ef8' : '#444' }} />
      </span>
    </th>
  )
}

export function SalesTable({
  orders,
  search,
  onSearchChange,
}: {
  orders: SalesOrder[]
  search: string
  onSearchChange: (q: string) => void
}) {
  const [sortKey, setSortKey] = React.useState<SortKey | null>('createdAt')
  const [sortDir, setSortDir] = React.useState<SortDir>('desc')

  function toggle(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
      return
    }
    if (sortDir === 'asc') setSortDir('desc')
    else if (sortDir === 'desc') { setSortKey(null); setSortDir(null) }
    else setSortDir('asc')
  }

  const displayed = useDisplayedSales(orders, search, sortKey, sortDir)

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#444' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search buyer or product…"
            className="w-full pl-8 pr-3 py-2 text-[12px] rounded-lg outline-none"
            style={{
              background: '#161618',
              border: '1px solid #1e1e24',
              color: '#e8e6e2',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </div>
        <span className="text-[11px]" style={{ color: '#555', fontFamily: 'var(--font-mono)' }}>
          {displayed.length} of {orders.length}
        </span>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ background: '#161618', border: '1px solid #1e1e24' }}>
        <table className="w-full text-[12px]" style={{ color: '#e8e6e2' }}>
          <thead style={{ background: '#0f0f12' }}>
            <tr>
              <SortHeader label="Date" active={sortKey === 'createdAt'} dir={sortDir} onClick={() => toggle('createdAt')} />
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>Order</th>
              <SortHeader label="Product" active={sortKey === 'productName'} dir={sortDir} onClick={() => toggle('productName')} />
              <SortHeader label="Qty" active={sortKey === 'qty'} dir={sortDir} onClick={() => toggle('qty')} align="right" />
              <SortHeader label="Unit" active={sortKey === 'unitPrice'} dir={sortDir} onClick={() => toggle('unitPrice')} align="right" />
              <SortHeader label="Total" active={sortKey === 'totalAmount'} dir={sortDir} onClick={() => toggle('totalAmount')} align="right" />
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: '#666', fontFamily: 'var(--font-mono)' }}>Real Margin</th>
              <SortHeader label="Buyer" active={sortKey === 'buyerName'} dir={sortDir} onClick={() => toggle('buyerName')} />
              <SortHeader label="Paid At" active={sortKey === 'paidAt'} dir={sortDir} onClick={() => toggle('paidAt')} />
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-[12px]" style={{ color: '#555' }}>
                  {orders.length === 0 ? 'No paid sales yet.' : 'No matches.'}
                </td>
              </tr>
            ) : displayed.map((o) => (
              <tr key={o.id} className="border-t" style={{ borderColor: '#1a1a1e' }}>
                <td className="px-3 py-2">{formatDate(o.createdAt)}</td>
                <td className="px-3 py-2 font-mono text-[11px]" style={{ color: '#888' }}>{o.id.slice(0, 8)}</td>
                <td className="px-3 py-2">{o.productName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{o.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatRM(o.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatRM(o.totalAmount)}</td>
                <td className="px-3 py-2 text-right">
                  <MarginBadge
                    status={o.marginStatus}
                    value={o.realMargin != null ? o.realMargin.toFixed(2) : null}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span>{o.buyerName ?? '—'}</span>
                    <span className="text-[10px]" style={{ color: '#666' }}>{o.buyerContact ?? ''}</span>
                  </div>
                </td>
                <td className="px-3 py-2">{formatDate(o.paidAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
