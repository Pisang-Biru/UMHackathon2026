import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import {
  computeTotals,
  computeRates,
  averageConfidence,
  dailyActivity,
  dailyStatusBreakdown,
  confidenceDistribution,
  dailySuccessRate,
} from '#/lib/agent-stats'
import {
  computeRunTotals,
  computeRunCost,
  dailyRunActivity,
  dailyRunStatusBreakdown,
  averageDurationMs,
  type RunRow,
  type RunStatus,
} from '#/lib/agent-run-stats'

async function requireSession() {
  const { getRequest } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) throw redirect({ to: '/login' })
  return session
}

async function requireBusinessOwner(businessId: string, userId: string) {
  const business = await prisma.business.findFirst({ where: { id: businessId, userId } })
  if (!business) throw new Error('Business not found or access denied')
  return business
}

function serializeAction(a: any) {
  return { ...a, costUsd: a.costUsd == null ? null : a.costUsd.toNumber() }
}

// agentType is whatever the backend registry exposes (Python AGENT_META.id).
// We do NOT maintain a frontend allowlist — adding a new agent must not
// require touching this file. Validate shape only: a slug-like identifier.
const AGENT_TYPE_RE = /^[a-z][a-z0-9_]*$/i

function validateAgentType(raw: unknown): string {
  if (typeof raw !== 'string' || !AGENT_TYPE_RE.test(raw)) {
    throw new Error('Invalid agentType id')
  }
  return raw
}

function validateCommon(data: unknown) {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
  const d = data as Record<string, unknown>
  if (typeof d.businessId !== 'string') throw new Error('businessId required')
  const agentType = validateAgentType(d.agentType)
  return { businessId: d.businessId, agentType, raw: d }
}

export const fetchAgentStats = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    const { businessId, agentType, raw } = validateCommon(data)
    const rangeDays = typeof raw.rangeDays === 'number' ? raw.rangeDays : 14
    return { businessId, agentType, rangeDays }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const since = new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000)
    const [actions, latestRun] = await Promise.all([
      prisma.agentAction.findMany({
        where: { businessId: data.businessId, agentType: data.agentType, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.agentAction.findFirst({
        where: { businessId: data.businessId, agentType: data.agentType },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const totals = computeTotals(actions)
    const rates = computeRates(totals)
    return {
      latestRun: latestRun ? serializeAction(latestRun) : null,
      totals,
      autoSendRate: rates.autoSendRate,
      approvalRate: rates.approvalRate,
      avgConfidence: averageConfidence(actions),
      runActivity: dailyActivity(actions, data.rangeDays),
      statusBreakdown: dailyStatusBreakdown(actions, data.rangeDays),
      confidenceDistribution: confidenceDistribution(actions),
      successRate: dailySuccessRate(actions, data.rangeDays),
      recent: actions.slice(0, 10).map(serializeAction),
    }
  })

export const fetchAgentRuns = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    const { businessId, agentType, raw } = validateCommon(data)
    const status = raw.status
    if (status !== undefined && status !== 'PENDING' && status !== 'APPROVED' && status !== 'REJECTED' && status !== 'AUTO_SENT') {
      throw new Error('Invalid status filter')
    }
    const limit =
      typeof raw.limit === 'number'
        ? Math.min(Math.max(Math.floor(raw.limit), 1), 100)
        : 50
    const cursor = typeof raw.cursor === 'string' ? raw.cursor : undefined
    return { businessId, agentType, status: status as undefined | 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_SENT', limit, cursor }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const where: Record<string, unknown> = { businessId: data.businessId, agentType: data.agentType }
    if (data.status) where.status = data.status

    const rows = await prisma.agentAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: data.limit + 1,
      ...(data.cursor ? { cursor: { id: data.cursor }, skip: 1 } : {}),
    })
    const hasMore = rows.length > data.limit
    const page = hasMore ? rows.slice(0, data.limit) : rows
    return { rows: page.map(serializeAction), nextCursor: hasMore ? page[page.length - 1].id : null }
  })

export const fetchAgentBudget = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    const { businessId, agentType, raw } = validateCommon(data)
    const rangeDays = typeof raw.rangeDays === 'number' ? raw.rangeDays : 30
    return { businessId, agentType, rangeDays }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const since = data.rangeDays > 0 ? new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000) : new Date(0)
    const rows = await prisma.agentAction.findMany({
      where: { businessId: data.businessId, agentType: data.agentType, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        inputTokens: true,
        outputTokens: true,
        cachedTokens: true,
        costUsd: true,
      },
    })

    let inputTokens = 0
    let outputTokens = 0
    let cachedTokens = 0
    let totalCostUsd = 0
    for (const r of rows) {
      inputTokens += r.inputTokens ?? 0
      outputTokens += r.outputTokens ?? 0
      cachedTokens += r.cachedTokens ?? 0
      totalCostUsd += r.costUsd ? Number(r.costUsd) : 0
    }
    return {
      totals: { inputTokens, outputTokens, cachedTokens, totalCostUsd },
      rows: rows.map((r) => ({ ...r, costUsd: r.costUsd == null ? null : r.costUsd.toNumber() })),
    }
  })

function serializeRun(r: any): RunRow {
  return {
    id: r.id,
    agentType: r.agentType,
    kind: r.kind,
    summary: r.summary,
    status: r.status as RunStatus,
    durationMs: r.durationMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cachedTokens: r.cachedTokens,
    costUsd: r.costUsd == null ? null : r.costUsd.toNumber(),
    refTable: r.refTable,
    refId: r.refId,
    createdAt: r.createdAt,
  }
}

export const fetchAgentDashboard = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    const { businessId, agentType, raw } = validateCommon(data)
    const rangeDays = typeof raw.rangeDays === 'number' ? raw.rangeDays : 14
    return { businessId, agentType, rangeDays }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const since = new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000)
    const [rows, latest] = await Promise.all([
      prisma.agentRun.findMany({
        where: { businessId: data.businessId, agentType: data.agentType, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.agentRun.findFirst({
        where: { businessId: data.businessId, agentType: data.agentType },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const runs = rows.map(serializeRun)
    return {
      totals: computeRunTotals(runs),
      cost: computeRunCost(runs),
      activity: dailyRunActivity(runs, data.rangeDays),
      statusBreakdown: dailyRunStatusBreakdown(runs, data.rangeDays),
      avgDurationMs: averageDurationMs(runs),
      recent: runs.slice(0, 10),
      latestRun: latest ? serializeRun(latest) : null,
    }
  })
