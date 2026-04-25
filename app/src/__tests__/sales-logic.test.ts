import { describe, it, expect } from 'vitest'
import {
  resolveRangeBounds,
  computeKpis,
  computeTopProducts,
  buildSeries,
  serializeSalesCsv,
  type SalesOrder,
} from '#/lib/sales-logic'

const T0 = new Date('2026-04-25T12:00:00Z')

function order(partial: Partial<SalesOrder>): SalesOrder {
  return {
    id: 'o1',
    createdAt: new Date('2026-04-25T10:00:00Z'),
    paidAt: new Date('2026-04-25T10:05:00Z'),
    productId: 'p1',
    productName: 'Pisang Goreng',
    qty: 1,
    unitPrice: 10,
    totalAmount: 10,
    buyerName: 'Ali',
    buyerContact: '012-3456789',
    ...partial,
  }
}

describe('resolveRangeBounds', () => {
  it('returns null for "all"', () => {
    expect(resolveRangeBounds('all', T0)).toBeNull()
  })

  it('returns start of today for "today"', () => {
    const b = resolveRangeBounds('today', T0)!
    expect(b.toISOString()).toBe('2026-04-25T00:00:00.000Z')
  })

  it('returns 6 days before start-of-today for "week" (so 7 buckets ending today)', () => {
    const b = resolveRangeBounds('week', T0)!
    expect(b.toISOString()).toBe('2026-04-19T00:00:00.000Z')
  })

  it('returns 29 days before start-of-today for "month" (so 30 buckets ending today)', () => {
    const b = resolveRangeBounds('month', T0)!
    expect(b.toISOString()).toBe('2026-03-27T00:00:00.000Z')
  })
})

describe('computeKpis', () => {
  it('returns zeros for empty input', () => {
    const k = computeKpis([])
    expect(k).toEqual({ revenue: 0, orderCount: 0, avgOrderValue: 0, topProduct: null })
  })

  it('sums revenue and counts orders', () => {
    const k = computeKpis([
      order({ id: 'a', totalAmount: 10, productId: 'p1', productName: 'A' }),
      order({ id: 'b', totalAmount: 30, productId: 'p2', productName: 'B' }),
    ])
    expect(k.revenue).toBe(40)
    expect(k.orderCount).toBe(2)
    expect(k.avgOrderValue).toBe(20)
  })

  it('picks top product by total revenue', () => {
    const k = computeKpis([
      order({ id: 'a', totalAmount: 10, productId: 'p1', productName: 'A' }),
      order({ id: 'b', totalAmount: 30, productId: 'p2', productName: 'B' }),
      order({ id: 'c', totalAmount: 5, productId: 'p2', productName: 'B' }),
    ])
    expect(k.topProduct).toEqual({ name: 'B', revenue: 35 })
  })
})

describe('computeTopProducts', () => {
  it('returns top 5 sorted desc by revenue', () => {
    const orders = ['A','B','C','D','E','F'].map((n, i) =>
      order({ id: `o${i}`, productId: `p${i}`, productName: n, totalAmount: (i + 1) * 10 })
    )
    const top = computeTopProducts(orders)
    expect(top).toHaveLength(5)
    expect(top[0]).toEqual({ name: 'F', revenue: 60 })
    expect(top[4]).toEqual({ name: 'B', revenue: 20 })
  })

  it('returns empty array for empty input', () => {
    expect(computeTopProducts([])).toEqual([])
  })
})

describe('buildSeries', () => {
  it('builds 24 hourly buckets for "today"', () => {
    const s = buildSeries([order({ createdAt: new Date('2026-04-25T10:30:00Z'), totalAmount: 10 })], 'today', T0)
    expect(s).toHaveLength(24)
    expect(s[10]).toEqual({ bucket: '10:00', revenue: 10 })
    expect(s[0].revenue).toBe(0)
  })

  it('builds 7 daily buckets for "week"', () => {
    const s = buildSeries([], 'week', T0)
    expect(s).toHaveLength(7)
  })

  it('builds ~30 daily buckets for "month"', () => {
    const s = buildSeries([], 'month', T0)
    expect(s).toHaveLength(30)
  })

  it('week series last bucket is today and includes today\'s orders', () => {
    const todayOrder = order({ createdAt: new Date('2026-04-25T08:00:00Z'), totalAmount: 25 })
    const s = buildSeries([todayOrder], 'week', T0)
    expect(s).toHaveLength(7)
    expect(s[6].revenue).toBe(25)
  })

  it('returns single bucket for "all" with no orders', () => {
    const s = buildSeries([], 'all', T0)
    expect(s).toHaveLength(1)
    expect(s[0].revenue).toBe(0)
  })
})

describe('serializeSalesCsv', () => {
  it('produces a header + one row per order', () => {
    const csv = serializeSalesCsv([order({})])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Date,Order ID,Product,Qty,Unit Price,Total,Buyer Name,Buyer Contact,Paid At')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Pisang Goreng')
    expect(lines[1]).toContain('Ali')
  })

  it('quotes fields containing commas', () => {
    const csv = serializeSalesCsv([order({ buyerName: 'Smith, John' })])
    expect(csv).toContain('"Smith, John"')
  })

  it('escapes embedded double quotes', () => {
    const csv = serializeSalesCsv([order({ buyerName: 'He said "hi"' })])
    expect(csv).toContain('"He said ""hi"""')
  })

  it('renders null buyer fields as empty', () => {
    const csv = serializeSalesCsv([order({ buyerName: null, buyerContact: null })])
    const lines = csv.split('\n')
    expect(lines[1].split(',').slice(6, 8)).toEqual(['', ''])
  })
})
