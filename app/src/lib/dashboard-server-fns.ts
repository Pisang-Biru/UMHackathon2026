// app/src/lib/dashboard-server-fns.ts
import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import { bucketActivity, computeSuccessRate, buildAgentCards } from '#/lib/dashboard-logic'

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

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#f59e0b',
  APPROVED: '#00c97a',
  REJECTED: '#ef4444',
  AUTO_SENT: '#3b7ef8',
}

export const fetchDashboardStats = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).businessId !== 'string'
    ) {
      throw new Error('businessId required')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const fourteenDaysAgo = new Date(Date.now() - FOURTEEN_DAYS_MS)

    const [pendingCount, totalCount, statusGroups, recentDates, allActions] = await Promise.all([
      prisma.agentAction.count({
        where: { businessId: data.businessId, status: 'PENDING' },
      }),
      prisma.agentAction.count({
        where: { businessId: data.businessId },
      }),
      prisma.agentAction.groupBy({
        by: ['status'],
        where: { businessId: data.businessId },
        _count: { _all: true },
      }),
      prisma.agentAction.findMany({
        where: { businessId: data.businessId, createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true },
      }),
      prisma.agentAction.findMany({
        where: { businessId: data.businessId },
        select: { agentType: true, status: true, customerMsg: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const agents = buildAgentCards(allActions)
    const agentCount = agents.length

    // Per-agent action counts for "By Agent" chart
    const countByAgent = new Map<string, number>()
    for (const a of allActions) {
      countByAgent.set(a.agentType, (countByAgent.get(a.agentType) ?? 0) + 1)
    }

    return {
      agents,
      stats: {
        agentCount,
        pendingCount,
        totalCount,
      },
      charts: {
        activity: bucketActivity(recentDates.map((r) => r.createdAt)),
        byStatus: statusGroups.map((g) => ({
          label: g.status,
          count: g._count._all,
          color: STATUS_COLORS[g.status] ?? '#555',
        })),
        byAgent: Array.from(countByAgent.entries()).map(([label, count]) => ({
          label,
          count,
          color: '#a78bfa',
        })),
        successRate: computeSuccessRate(statusGroups),
      },
    }
  })
