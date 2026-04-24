import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import { enqueueProductReindex } from '#/lib/agents-reindex'

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

function serializeOrder(o: any) {
  return {
    ...o,
    unitPrice: o.unitPrice == null ? null : Number(o.unitPrice),
    totalAmount: o.totalAmount == null ? null : Number(o.totalAmount),
  }
}

export const fetchPublicOrder = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).orderId !== 'string') {
      throw new Error('Invalid input')
    }
    return { orderId: (data as { orderId: string }).orderId }
  })
  .handler(async ({ data }) => {
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      include: { product: { select: { id: true, name: true } }, business: { select: { name: true } } },
    })
    if (!order) return null
    return {
      order: serializeOrder({ ...order, business: undefined, product: undefined }),
      product: order.product,
      businessName: order.business.name,
    }
  })

export const submitMockPayment = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.orderId !== 'string') throw new Error('orderId required')
    if (typeof d.buyerName !== 'string' || d.buyerName.trim().length < 1) throw new Error('buyerName required')
    if (typeof d.buyerContact !== 'string' || d.buyerContact.trim().length < 1) throw new Error('buyerContact required')
    return { orderId: d.orderId, buyerName: d.buyerName.trim(), buyerContact: d.buyerContact.trim() }
  })
  .handler(async ({ data }) => {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: data.orderId } })
      if (!order) throw new Error('Order not found')
      if (order.status !== 'PENDING_PAYMENT') throw new Error(`Order is ${order.status}`)

      const dec = await tx.product.updateMany({
        where: { id: order.productId, stock: { gte: order.qty } },
        data: { stock: { decrement: order.qty } },
      })
      if (dec.count === 0) throw new Error('Out of stock')

      const updated = await tx.order.update({
        where: { id: data.orderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          buyerName: data.buyerName,
          buyerContact: data.buyerContact,
        },
      })
      return { updated, productId: order.productId }
    })
    enqueueProductReindex(result.productId)
    return serializeOrder(result.updated)
  })

export const acknowledgeOrder = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).orderId !== 'string') {
      throw new Error('Invalid input')
    }
    return { orderId: (data as { orderId: string }).orderId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const order = await prisma.order.findUnique({ where: { id: data.orderId }, include: { business: true } })
    if (!order || order.business.userId !== session.user.id) throw new Error('Order not found or access denied')
    if (order.acknowledgedAt) return serializeOrder(order)
    const updated = await prisma.order.update({
      where: { id: data.orderId },
      data: { acknowledgedAt: new Date() },
    })
    return serializeOrder(updated)
  })

export const fetchAgentSales = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (typeof d.agentType !== 'string') throw new Error('agentType required')
    const rangeDays = typeof d.rangeDays === 'number' ? d.rangeDays : 30
    return { businessId: d.businessId, agentType: d.agentType, rangeDays }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const since = data.rangeDays > 0 ? new Date(Date.now() - data.rangeDays * 24 * 60 * 60 * 1000) : new Date(0)
    const orders = await prisma.order.findMany({
      where: { businessId: data.businessId, agentType: data.agentType, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { id: true, name: true } } },
    })

    let count = 0
    let revenue = 0
    for (const o of orders) {
      if (o.status === 'PAID') {
        count++
        revenue += Number(o.totalAmount)
      }
    }
    return {
      totals: { count, revenue },
      rows: orders.map((o) => ({
        ...serializeOrder({ ...o, product: undefined }),
        productName: o.product.name,
      })),
    }
  })
