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

const AGENTS_BASE_URL = process.env.AGENTS_URL ?? 'http://localhost:8000'

function serializeAction(a: any) {
  return {
    ...a,
    costUsd: a.costUsd == null ? null : a.costUsd.toNumber(),
    bestDraft: a.bestDraft ?? null,
    escalationSummary: a.escalationSummary ?? null,
  }
}

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

    let actionWhere: Record<string, unknown> = { businessId: data.businessId }
    let orderWhere: Record<string, unknown> = { businessId: data.businessId }
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS)

    if (data.tab === 'mine') {
      actionWhere = { ...actionWhere, status: 'PENDING' }
      orderWhere = { ...orderWhere, status: 'PAID', acknowledgedAt: null }
    } else if (data.tab === 'recent') {
      actionWhere = { ...actionWhere, status: { not: 'AUTO_SENT' }, createdAt: { gte: sevenDaysAgo } }
      orderWhere = { ...orderWhere, status: { in: ['PAID', 'CANCELLED'] }, createdAt: { gte: sevenDaysAgo } }
    } else if (data.tab === 'unread') {
      actionWhere = { ...actionWhere, status: { not: 'AUTO_SENT' }, viewedAt: null }
      orderWhere = { ...orderWhere, status: 'PAID', acknowledgedAt: null }
    }

    const [actions, orders] = await Promise.all([
      prisma.agentAction.findMany({ where: actionWhere, orderBy: { createdAt: 'desc' } }),
      prisma.order.findMany({
        where: orderWhere,
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { name: true } } },
      }),
    ])

    const items = [
      ...actions.map((a) => ({ kind: 'action' as const, action: serializeAction(a), createdAt: a.createdAt })),
      ...orders.map((o) => ({
        kind: 'order' as const,
        order: {
          id: o.id,
          businessId: o.businessId,
          productName: o.product.name,
          qty: o.qty,
          totalAmount: Number(o.totalAmount),
          buyerName: o.buyerName,
          buyerContact: o.buyerContact,
          status: o.status,
          paidAt: o.paidAt,
          acknowledgedAt: o.acknowledgedAt,
          createdAt: o.createdAt,
        },
        createdAt: o.createdAt,
      })),
    ]
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return items.map(({ createdAt, ...rest }) => rest)
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

    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS)
    const [mineActions, mineOrders, recentActions, recentOrders, unreadActions, unreadOrders] = await Promise.all([
      prisma.agentAction.count({ where: { businessId: data.businessId, status: 'PENDING' } }),
      prisma.order.count({ where: { businessId: data.businessId, status: 'PAID', acknowledgedAt: null } }),
      prisma.agentAction.count({
        where: {
          businessId: data.businessId,
          status: { not: 'AUTO_SENT' },
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.order.count({
        where: {
          businessId: data.businessId,
          status: { in: ['PAID', 'CANCELLED'] },
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.agentAction.count({ where: { businessId: data.businessId, status: { not: 'AUTO_SENT' }, viewedAt: null } }),
      prisma.order.count({ where: { businessId: data.businessId, status: 'PAID', acknowledgedAt: null } }),
    ])
    return {
      mine: mineActions + mineOrders,
      recent: recentActions + recentOrders,
      unread: unreadActions + unreadOrders,
    }
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
    if (action.viewedAt) return serializeAction(action)
    const updated = await prisma.agentAction.update({
      where: { id: data.actionId },
      data: { viewedAt: new Date() },
    })
    return serializeAction(updated)
  })

export const approveAction = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).actionId !== 'string') {
      throw new Error('Invalid input')
    }
    const d = data as Record<string, unknown>
    return {
      actionId: d.actionId as string,
      reply: typeof d.reply === 'string' ? d.reply : null,
    }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const action = await requireActionOwner(data.actionId, session.user.id)
    if (action.status !== 'PENDING') throw new Error(`Action is ${action.status}, not PENDING`)
    const finalReply = data.reply ?? action.draftReply
    const updated = await prisma.agentAction.update({
      where: { id: data.actionId },
      data: { status: 'APPROVED', finalReply },
    })
    return serializeAction(updated)
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
    const updated = await prisma.agentAction.update({
      where: { id: data.actionId },
      data: { status: 'APPROVED', finalReply: data.reply },
    })
    return serializeAction(updated)
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
    const updated = await prisma.agentAction.update({
      where: { id: data.actionId },
      data: { status: 'REJECTED' },
    })
    return serializeAction(updated)
  })

export async function unsendAction(actionId: string): Promise<void> {
  const r = await fetch(`${AGENTS_BASE_URL}/agent/actions/${actionId}/unsend`, {
    method: 'POST',
  })
  if (!r.ok) {
    const detail = await r.text()
    throw new Error(`Unsend failed: ${r.status} ${detail}`)
  }
}

export async function fetchIterations(actionId: string): Promise<unknown[]> {
  const r = await fetch(`${AGENTS_BASE_URL}/agent/actions/${actionId}/iterations`)
  if (!r.ok) throw new Error(`Iterations fetch failed: ${r.status}`)
  const data = await r.json()
  return data.iterations ?? []
}
