import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import type { InboxTab } from '#/lib/inbox-logic'

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

async function requireActionOwner(actionId: string, userId: string) {
  const action = await prisma.agentAction.findFirst({
    where: { id: actionId },
    include: { business: true },
  })
  if (!action || action.business.userId !== userId) {
    throw new Error('Action not found or access denied')
  }
  return action
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export const fetchInbox = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (d.tab !== 'mine' && d.tab !== 'recent' && d.tab !== 'unread') {
      throw new Error('tab must be mine, recent, or unread')
    }
    return { businessId: d.businessId, tab: d.tab as InboxTab }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const whereBase = { businessId: data.businessId }
    let where: Record<string, unknown> = whereBase
    if (data.tab === 'mine') {
      where = { ...whereBase, status: 'PENDING' }
    } else if (data.tab === 'recent') {
      where = {
        ...whereBase,
        status: { not: 'AUTO_SENT' },
        createdAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) },
      }
    } else if (data.tab === 'unread') {
      where = { ...whereBase, status: { not: 'AUTO_SENT' }, viewedAt: null }
    }

    return prisma.agentAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })
  })

export const fetchTabCounts = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const [mine, recent, unread] = await Promise.all([
      prisma.agentAction.count({ where: { businessId: data.businessId, status: 'PENDING' } }),
      prisma.agentAction.count({
        where: {
          businessId: data.businessId,
          status: { not: 'AUTO_SENT' },
          createdAt: { gte: new Date(Date.now() - SEVEN_DAYS_MS) },
        },
      }),
      prisma.agentAction.count({
        where: { businessId: data.businessId, status: { not: 'AUTO_SENT' }, viewedAt: null },
      }),
    ])
    return { mine, recent, unread }
  })

export const markAsViewed = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).actionId !== 'string') {
      throw new Error('Invalid input')
    }
    return { actionId: (data as { actionId: string }).actionId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const action = await requireActionOwner(data.actionId, session.user.id)
    if (action.viewedAt) return action
    return prisma.agentAction.update({
      where: { id: data.actionId },
      data: { viewedAt: new Date() },
    })
  })

export const approveAction = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).actionId !== 'string') {
      throw new Error('Invalid input')
    }
    return { actionId: (data as { actionId: string }).actionId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const action = await requireActionOwner(data.actionId, session.user.id)
    if (action.status !== 'PENDING') throw new Error(`Action is ${action.status}, not PENDING`)
    return prisma.agentAction.update({
      where: { id: data.actionId },
      data: { status: 'APPROVED', finalReply: action.draftReply },
    })
  })

export const editAction = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.actionId !== 'string') throw new Error('actionId required')
    if (typeof d.reply !== 'string' || d.reply.trim().length < 1) throw new Error('reply required')
    return { actionId: d.actionId, reply: d.reply.trim() }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const action = await requireActionOwner(data.actionId, session.user.id)
    if (action.status !== 'PENDING') throw new Error(`Action is ${action.status}, not PENDING`)
    return prisma.agentAction.update({
      where: { id: data.actionId },
      data: { status: 'APPROVED', finalReply: data.reply },
    })
  })

export const rejectAction = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).actionId !== 'string') {
      throw new Error('Invalid input')
    }
    return { actionId: (data as { actionId: string }).actionId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const action = await requireActionOwner(data.actionId, session.user.id)
    if (action.status !== 'PENDING') throw new Error(`Action is ${action.status}, not PENDING`)
    return prisma.agentAction.update({
      where: { id: data.actionId },
      data: { status: 'REJECTED' },
    })
  })
