import type { AgentActionStatus } from '#/lib/inbox-logic'

export interface StatAction {
  status: AgentActionStatus
  confidence: number
  createdAt: Date
}

export interface Totals {
  total: number
  pending: number
  approved: number
  rejected: number
  autoSent: number
}

export function computeTotals(actions: StatAction[]): Totals {
  const totals: Totals = { total: 0, pending: 0, approved: 0, rejected: 0, autoSent: 0 }
  for (const a of actions) {
    totals.total++
    if (a.status === 'PENDING') totals.pending++
    else if (a.status === 'APPROVED') totals.approved++
    else if (a.status === 'REJECTED') totals.rejected++
    else if (a.status === 'AUTO_SENT') totals.autoSent++
  }
  return totals
}

export function computeRates(totals: Totals): { autoSendRate: number; approvalRate: number } {
  const autoSendRate = totals.total === 0 ? 0 : totals.autoSent / totals.total
  const decided = totals.approved + totals.rejected
  const approvalRate = decided === 0 ? 0 : totals.approved / decided
  return { autoSendRate, approvalRate }
}

export function averageConfidence(actions: StatAction[]): number {
  if (actions.length === 0) return 0
  const sum = actions.reduce((acc, a) => acc + a.confidence, 0)
  return sum / actions.length
}

function dayKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function lastNDays(days: number, now: Date): string[] {
  const out: string[] = []
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setUTCDate(base.getUTCDate() - i)
    out.push(dayKey(d))
  }
  return out
}

export function dailyActivity(
  actions: StatAction[],
  days: number,
  now: Date = new Date(),
): { date: string; count: number }[] {
  const keys = lastNDays(days, now)
  const counts = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const a of actions) {
    const key = dayKey(a.createdAt)
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1)
  }
  return keys.map((date) => ({ date, count: counts.get(date)! }))
}

export interface StatusDay {
  date: string
  pending: number
  approved: number
  rejected: number
  autoSent: number
}

export function dailyStatusBreakdown(
  actions: StatAction[],
  days: number,
  now: Date = new Date(),
): StatusDay[] {
  const keys = lastNDays(days, now)
  const map = new Map<string, StatusDay>(
    keys.map((k) => [k, { date: k, pending: 0, approved: 0, rejected: 0, autoSent: 0 }]),
  )
  for (const a of actions) {
    const day = map.get(dayKey(a.createdAt))
    if (!day) continue
    if (a.status === 'PENDING') day.pending++
    else if (a.status === 'APPROVED') day.approved++
    else if (a.status === 'REJECTED') day.rejected++
    else if (a.status === 'AUTO_SENT') day.autoSent++
  }
  return keys.map((k) => map.get(k)!)
}

const CONF_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0-0.2', min: 0, max: 0.2 },
  { label: '0.2-0.4', min: 0.2, max: 0.4 },
  { label: '0.4-0.6', min: 0.4, max: 0.6 },
  { label: '0.6-0.8', min: 0.6, max: 0.8 },
  { label: '0.8-1.0', min: 0.8, max: 1.0001 },
]

export function confidenceDistribution(actions: StatAction[]): { bucket: string; count: number }[] {
  const counts = CONF_BUCKETS.map((b) => ({ bucket: b.label, count: 0 }))
  for (const a of actions) {
    const i = CONF_BUCKETS.findIndex((b) => a.confidence >= b.min && a.confidence < b.max)
    if (i >= 0) counts[i].count++
  }
  return counts
}

export function dailySuccessRate(
  actions: StatAction[],
  days: number,
  now: Date = new Date(),
): { date: string; rate: number }[] {
  const breakdown = dailyStatusBreakdown(actions, days, now)
  return breakdown.map((d) => {
    const total = d.pending + d.approved + d.rejected + d.autoSent
    const good = d.approved + d.autoSent
    return { date: d.date, rate: total === 0 ? 0 : good / total }
  })
}
