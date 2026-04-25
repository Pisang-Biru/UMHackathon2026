import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import type { GoalRow, GoalStatus } from '#/lib/goals-logic'

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

async function requireGoalOwner(goalId: string, userId: string) {
  const goal = await prisma.goal.findFirst({
    where: { id: goalId },
    include: { business: true },
  })
  if (!goal || goal.business.userId !== userId) {
    throw new Error('Goal not found or access denied')
  }
  return goal
}

function serialize(g: { id: string; text: string; status: GoalStatus; createdAt: Date; updatedAt: Date }): GoalRow {
  return {
    id: g.id,
    text: g.text,
    status: g.status,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  }
}

export const fetchGoals = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    return { businessId: d.businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const rows = await prisma.goal.findMany({
      where: { businessId: data.businessId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(serialize)
  })

export const createGoal = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (typeof d.text !== 'string') throw new Error('text required')
    const text = d.text.trim()
    if (text.length === 0) throw new Error('text must not be empty')
    if (text.length > 500) throw new Error('text must be 500 characters or fewer')
    return { businessId: d.businessId, text }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const created = await prisma.goal.create({
      data: { businessId: data.businessId, text: data.text },
    })
    return serialize(created)
  })

export const updateGoal = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.id !== 'string') throw new Error('id required')
    const update: { text?: string; status?: GoalStatus } = {}
    if (d.text !== undefined) {
      if (typeof d.text !== 'string') throw new Error('text must be string')
      const text = d.text.trim()
      if (text.length === 0) throw new Error('text must not be empty')
      if (text.length > 500) throw new Error('text must be 500 characters or fewer')
      update.text = text
    }
    if (d.status !== undefined) {
      if (d.status !== 'ACTIVE' && d.status !== 'COMPLETED' && d.status !== 'ARCHIVED') {
        throw new Error('invalid status')
      }
      update.status = d.status
    }
    if (update.text === undefined && update.status === undefined) {
      throw new Error('nothing to update')
    }
    return { id: d.id, update }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireGoalOwner(data.id, session.user.id)
    const updated = await prisma.goal.update({
      where: { id: data.id },
      data: data.update,
    })
    return serialize(updated)
  })

export const deleteGoal = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.id !== 'string') throw new Error('id required')
    return { id: d.id }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireGoalOwner(data.id, session.user.id)
    await prisma.goal.update({
      where: { id: data.id },
      data: { deletedAt: new Date() },
    })
    return { ok: true }
  })
