export type SalesRange = 'today' | 'week' | 'month' | 'all'

export type SalesOrder = {
  id: string
  createdAt: Date
  paidAt: Date | null
  productId: string
  productName: string
  qty: number
  unitPrice: number
  totalAmount: number
  buyerName: string | null
  buyerContact: string | null
}

export type SalesKpis = {
  revenue: number
  orderCount: number
  avgOrderValue: number
  topProduct: { name: string; revenue: number } | null
}

export type SeriesPoint = { bucket: string; revenue: number }

export function resolveRangeBounds(range: SalesRange, now: Date): Date | null {
  if (range === 'all') return null
  if (range === 'today') {
    const d = new Date(now)
    d.setUTCHours(0, 0, 0, 0)
    return d
  }
  const days = range === 'week' ? 7 : 30
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

export function computeKpis(orders: SalesOrder[]): SalesKpis {
  if (orders.length === 0) {
    return { revenue: 0, orderCount: 0, avgOrderValue: 0, topProduct: null }
  }
  const revenue = orders.reduce((s, o) => s + o.totalAmount, 0)
  const orderCount = orders.length
  const avgOrderValue = revenue / orderCount

  const byProduct = new Map<string, { name: string; revenue: number }>()
  for (const o of orders) {
    const cur = byProduct.get(o.productId)
    if (cur) cur.revenue += o.totalAmount
    else byProduct.set(o.productId, { name: o.productName, revenue: o.totalAmount })
  }
  let topProduct: { name: string; revenue: number } | null = null
  for (const v of byProduct.values()) {
    if (!topProduct || v.revenue > topProduct.revenue) topProduct = v
  }
  return { revenue, orderCount, avgOrderValue, topProduct }
}

export function computeTopProducts(orders: SalesOrder[]): Array<{ name: string; revenue: number }> {
  const byProduct = new Map<string, { name: string; revenue: number }>()
  for (const o of orders) {
    const cur = byProduct.get(o.productId)
    if (cur) cur.revenue += o.totalAmount
    else byProduct.set(o.productId, { name: o.productName, revenue: o.totalAmount })
  }
  return Array.from(byProduct.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
}

export function buildSeries(orders: SalesOrder[], range: SalesRange, now: Date): SeriesPoint[] {
  if (range === 'today') {
    const buckets: SeriesPoint[] = Array.from({ length: 24 }, (_, h) => ({
      bucket: `${String(h).padStart(2, '0')}:00`,
      revenue: 0,
    }))
    const startOfDay = new Date(now)
    startOfDay.setUTCHours(0, 0, 0, 0)
    for (const o of orders) {
      if (o.createdAt < startOfDay) continue
      const h = o.createdAt.getUTCHours()
      buckets[h].revenue += o.totalAmount
    }
    return buckets
  }

  if (range === 'week' || range === 'month') {
    const days = range === 'week' ? 7 : 30
    const buckets: SeriesPoint[] = []
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    start.setUTCHours(0, 0, 0, 0)
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
      buckets.push({ bucket: formatDayLabel(d, range), revenue: 0 })
    }
    for (const o of orders) {
      const dayIndex = Math.floor((o.createdAt.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
      if (dayIndex < 0 || dayIndex >= days) continue
      buckets[dayIndex].revenue += o.totalAmount
    }
    return buckets
  }

  // 'all' — weekly buckets from earliest order to now, or single bucket if empty
  if (orders.length === 0) {
    return [{ bucket: 'No data', revenue: 0 }]
  }
  const earliest = orders.reduce((min, o) => (o.createdAt < min ? o.createdAt : min), orders[0].createdAt)
  const start = new Date(earliest)
  start.setUTCHours(0, 0, 0, 0)
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const weekCount = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / weekMs))
  const buckets: SeriesPoint[] = []
  for (let i = 0; i < weekCount; i++) {
    const d = new Date(start.getTime() + i * weekMs)
    buckets.push({ bucket: formatDayLabel(d, 'all'), revenue: 0 })
  }
  for (const o of orders) {
    const idx = Math.floor((o.createdAt.getTime() - start.getTime()) / weekMs)
    if (idx < 0 || idx >= weekCount) continue
    buckets[idx].revenue += o.totalAmount
  }
  return buckets
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDayLabel(d: Date, range: SalesRange): string {
  if (range === 'week') return WEEKDAY[d.getUTCDay()]
  return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`
}

export function serializeSalesCsv(orders: SalesOrder[]): string {
  const header = 'Date,Order ID,Product,Qty,Unit Price,Total,Buyer Name,Buyer Contact,Paid At'
  const rows = orders.map((o) => [
    o.createdAt.toISOString(),
    o.id,
    o.productName,
    String(o.qty),
    o.unitPrice.toFixed(2),
    o.totalAmount.toFixed(2),
    o.buyerName ?? '',
    o.buyerContact ?? '',
    o.paidAt ? o.paidAt.toISOString() : '',
  ].map(csvEscape).join(','))
  return [header, ...rows].join('\n')
}

function csvEscape(field: string): string {
  if (field === '') return ''
  if (/[",\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}
