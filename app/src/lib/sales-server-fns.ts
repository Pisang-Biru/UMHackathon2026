import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import {
  buildSeries,
  computeKpis,
  computeTopProducts,
  resolveRangeBounds,
  type SalesOrder,
  type SalesRange,
} from '#/lib/sales-logic'

async function requireSession() {
  const { getRequest } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) throw redirect({ to: '/login' })
  return session
}

async function requireBusinessOwner(businessId: string, userId: string) {
  const business = await prisma.business.findFirst({
    where: { id: businessId, userId },
  })
  if (!business) throw new Error('Business not found or access denied')
  return business
}

const VALID_RANGES: ReadonlyArray<SalesRange> = ['today', 'week', 'month', 'all']

export const fetchSales = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (typeof d.range !== 'string' || !VALID_RANGES.includes(d.range as SalesRange)) {
      throw new Error('range must be one of today|week|month|all')
    }
    return { businessId: d.businessId, range: d.range as SalesRange }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const now = new Date()
    const lowerBound = resolveRangeBounds(data.range, now)

    const rows = await prisma.order.findMany({
      where: {
        businessId: data.businessId,
        status: 'PAID',
        ...(lowerBound ? { createdAt: { gte: lowerBound } } : {}),
      },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })

    const orders: SalesOrder[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      paidAt: r.paidAt,
      productId: r.productId,
      productName: r.product.name,
      qty: r.qty,
      unitPrice: r.unitPrice.toNumber(),
      totalAmount: r.totalAmount.toNumber(),
      buyerName: r.buyerName,
      buyerContact: r.buyerContact,
      realMargin: r.realMargin ? r.realMargin.toNumber() : null,
      marginStatus: r.marginStatus ?? null,
    }))

    return {
      orders,
      kpis: computeKpis(orders),
      series: buildSeries(orders, data.range, now),
      topProducts: computeTopProducts(orders),
    }
  })
