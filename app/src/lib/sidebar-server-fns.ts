import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import { getAgentName } from '#/lib/agent-meta'

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

const SIDEBAR_COLORS = ['#3b7ef8', '#00c97a', '#a78bfa', '#f59e0b', '#ef4444']

export interface SidebarAgent {
  id: string
  name: string
  color: string
  live: boolean
}

export const fetchSidebarAgents = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }): Promise<SidebarAgent[]> => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const rows = await prisma.agentAction.groupBy({
      by: ['agentType'],
      where: { businessId: data.businessId },
      _max: { createdAt: true },
      _count: { _all: true },
    })

    if (rows.length === 0) return [{ id: 'support', name: getAgentName('support'), color: SIDEBAR_COLORS[0], live: false }]

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
    return rows.map((r, i) => ({
      id: r.agentType,
      name: getAgentName(r.agentType),
      color: SIDEBAR_COLORS[i % SIDEBAR_COLORS.length],
      live: r._max.createdAt ? r._max.createdAt >= fiveMinAgo : false,
    }))
  })
