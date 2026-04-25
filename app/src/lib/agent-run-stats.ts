export type RunStatus = 'OK' | 'FAILED' | 'SKIPPED'

export interface RunRow {
  id: string
  agentType: string
  kind: string
  summary: string
  status: RunStatus
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  cachedTokens: number | null
  costUsd: number | null
  refTable: string | null
  refId: string | null
  createdAt: Date
}

export interface RunTotals { runs: number; ok: number; failed: number; skipped: number }

export function computeRunTotals(rows: RunRow[]): RunTotals {
  const t: RunTotals = { runs: 0, ok: 0, failed: 0, skipped: 0 }
  for (const r of rows) {
    t.runs++
    if (r.status === 'OK') t.ok++
    else if (r.status === 'FAILED') t.failed++
    else if (r.status === 'SKIPPED') t.skipped++
  }
  return t
}

export function computeRunCost(rows: RunRow[]): { totalUsd: number; totalTokens: number } {
  let totalUsd = 0
  let totalTokens = 0
  for (const r of rows) {
    if (r.costUsd != null) totalUsd += r.costUsd
    totalTokens += (r.inputTokens ?? 0) + (r.outputTokens ?? 0) + (r.cachedTokens ?? 0)
  }
  return { totalUsd, totalTokens }
}

export function averageDurationMs(rows: RunRow[]): number {
  let sum = 0
  let n = 0
  for (const r of rows) {
    if (r.durationMs != null) { sum += r.durationMs; n++ }
  }
  return n === 0 ? 0 : Math.round(sum / n)
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

export function dailyRunActivity(rows: RunRow[], days: number, now: Date = new Date()): { date: string; count: number }[] {
  const buckets = new Map<string, number>()
  for (const k of lastNDays(days, now)) buckets.set(k, 0)
  for (const r of rows) {
    const k = dayKey(r.createdAt)
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1)
  }
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }))
}

export interface RunStatusDay { date: string; ok: number; failed: number; skipped: number }

export function dailyRunStatusBreakdown(rows: RunRow[], days: number, now: Date = new Date()): RunStatusDay[] {
  const buckets = new Map<string, RunStatusDay>()
  for (const k of lastNDays(days, now)) buckets.set(k, { date: k, ok: 0, failed: 0, skipped: 0 })
  for (const r of rows) {
    const k = dayKey(r.createdAt)
    const b = buckets.get(k)
    if (!b) continue
    if (r.status === 'OK') b.ok++
    else if (r.status === 'FAILED') b.failed++
    else if (r.status === 'SKIPPED') b.skipped++
  }
  return Array.from(buckets.values())
}
