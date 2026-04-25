import { describe, it, expect } from 'vitest'
import {
  computeRunTotals,
  computeRunCost,
  dailyRunActivity,
  dailyRunStatusBreakdown,
  averageDurationMs,
  type RunRow,
} from './agent-run-stats'

const mk = (over: Partial<RunRow> = {}): RunRow => ({
  id: 'r',
  agentType: 'finance',
  kind: 'k',
  summary: 's',
  status: 'OK',
  durationMs: 100,
  inputTokens: 10,
  outputTokens: 5,
  cachedTokens: 0,
  costUsd: 0.001,
  refTable: null,
  refId: null,
  createdAt: new Date('2026-04-26T00:00:00Z'),
  ...over,
})

describe('agent-run-stats', () => {
  it('computeRunTotals counts statuses', () => {
    const t = computeRunTotals([mk(), mk({ status: 'FAILED' }), mk({ status: 'SKIPPED' })])
    expect(t).toEqual({ runs: 3, ok: 1, failed: 1, skipped: 1 })
  })

  it('computeRunCost sums tokens + usd', () => {
    const c = computeRunCost([mk({ costUsd: 0.002, inputTokens: 1, outputTokens: 2, cachedTokens: 3 }), mk()])
    expect(c.totalUsd).toBeCloseTo(0.003, 6)
    expect(c.totalTokens).toBe(1 + 2 + 3 + 10 + 5 + 0)
  })

  it('dailyRunActivity bins by UTC day', () => {
    const a = dailyRunActivity([mk(), mk()], 3, new Date('2026-04-26T12:00:00Z'))
    expect(a.length).toBe(3)
    expect(a[2]).toEqual({ date: '2026-04-26', count: 2 })
  })

  it('dailyRunStatusBreakdown splits by status', () => {
    const b = dailyRunStatusBreakdown([mk(), mk({ status: 'FAILED' })], 1, new Date('2026-04-26T12:00:00Z'))
    expect(b[0]).toEqual({ date: '2026-04-26', ok: 1, failed: 1, skipped: 0 })
  })

  it('averageDurationMs ignores nulls', () => {
    expect(averageDurationMs([mk({ durationMs: 100 }), mk({ durationMs: 300 }), mk({ durationMs: null })])).toBe(200)
    expect(averageDurationMs([])).toBe(0)
  })
})
