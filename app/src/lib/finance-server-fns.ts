const AGENTS_URL = process.env.AGENTS_URL ?? 'http://localhost:8000'

export async function triggerFinanceCheck(orderId: string): Promise<void> {
  try {
    const res = await fetch(`${AGENTS_URL}/finance/check/${orderId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    if (!res.ok) {
      console.warn(`finance check failed for ${orderId}: ${res.status}`)
    }
  } catch (e) {
    console.warn(`finance check error for ${orderId}:`, e)
  }
}

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'

async function requireSession() {
  const { getRequest } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) throw redirect({ to: '/login' })
  return session
}

async function requireBusinessOwner(businessId: string, userId: string) {
  const business = await prisma.business.findFirst({ where: { id: businessId, userId } })
  if (!business) throw new Error('Business not found or access denied')
}

export const listFinanceAlerts = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    return { businessId: d.businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const rows = await prisma.financeAlert.findMany({
      where: { businessId: data.businessId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { order: true, product: true },
    })
    return rows.map(r => ({
      ...r,
      marginValue: r.marginValue ? r.marginValue.toNumber() : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      order: r.order ? { id: r.order.id } : null,
      product: r.product ? { id: r.product.id, name: r.product.name } : null,
    }))
  })

export const resolveFinanceAlert = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.alertId !== 'string') throw new Error('alertId required')
    return { alertId: d.alertId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const alert = await prisma.financeAlert.findFirst({
      where: { id: data.alertId, business: { userId: session.user.id } },
      select: { id: true },
    })
    if (!alert) throw new Error('Alert not found or access denied')
    const url = `${AGENTS_URL}/finance/alerts/${data.alertId}/resolve`
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) throw new Error(`resolve failed: ${res.status}`)
    return { ok: true }
  })
