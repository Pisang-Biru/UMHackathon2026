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
  const business = await prisma.business.findFirst({
    where: { id: businessId, userId },
  })
  if (!business) throw new Error('Business not found or access denied')
  return business
}

export const fetchProducts = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const products = await prisma.product.findMany({
      where: { businessId: data.businessId },
      orderBy: { createdAt: 'asc' },
    })
    return products.map(p => ({
      ...p,
      price: p.price.toNumber(),
      cogs: p.cogs ? p.cogs.toNumber() : null,
      packagingCost: p.packagingCost ? p.packagingCost.toNumber() : null,
    }))
  })

export const createProduct = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (typeof d.name !== 'string' || d.name.trim().length < 1) throw new Error('name required')
    if (typeof d.price !== 'number' || d.price < 0) throw new Error('price must be a non-negative number')
    if (typeof d.stock !== 'number' || d.stock < 0 || !Number.isInteger(d.stock)) throw new Error('stock must be a non-negative integer')
    const cogs =
      d.cogs === null ? null
      : typeof d.cogs === 'number' && d.cogs >= 0 ? d.cogs
      : d.cogs === undefined ? undefined
      : (() => { throw new Error('cogs must be a non-negative number or null') })()
    const packagingCost =
      d.packagingCost === null ? null
      : typeof d.packagingCost === 'number' && d.packagingCost >= 0 ? d.packagingCost
      : d.packagingCost === undefined ? undefined
      : (() => { throw new Error('packagingCost must be a non-negative number or null') })()
    return {
      businessId: d.businessId,
      name: d.name.trim(),
      price: d.price,
      stock: d.stock,
      description: typeof d.description === 'string' ? d.description.trim() || undefined : undefined,
      cogs,
      packagingCost,
    }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const cost: Record<string, number | null> = {}
    if (data.cogs !== undefined) cost.cogs = data.cogs
    if (data.packagingCost !== undefined) cost.packagingCost = data.packagingCost
    const product = await prisma.product.create({
      data: {
        businessId: data.businessId,
        name: data.name,
        price: data.price,
        stock: data.stock,
        description: data.description,
        ...cost,
      },
    })
    enqueueProductReindex(product.id)
    return {
      ...product,
      price: product.price.toNumber(),
      cogs: product.cogs ? product.cogs.toNumber() : null,
      packagingCost: product.packagingCost ? product.packagingCost.toNumber() : null,
    }
  })

export const updateProduct = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.id !== 'string') throw new Error('id required')
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (typeof d.name !== 'string' || d.name.trim().length < 1) throw new Error('name required')
    if (typeof d.price !== 'number' || d.price < 0) throw new Error('price must be a non-negative number')
    if (typeof d.stock !== 'number' || d.stock < 0 || !Number.isInteger(d.stock)) throw new Error('stock must be a non-negative integer')
    const cogs =
      d.cogs === null ? null
      : typeof d.cogs === 'number' && d.cogs >= 0 ? d.cogs
      : d.cogs === undefined ? undefined
      : (() => { throw new Error('cogs must be a non-negative number or null') })()
    const packagingCost =
      d.packagingCost === null ? null
      : typeof d.packagingCost === 'number' && d.packagingCost >= 0 ? d.packagingCost
      : d.packagingCost === undefined ? undefined
      : (() => { throw new Error('packagingCost must be a non-negative number or null') })()
    return {
      id: d.id,
      businessId: d.businessId,
      name: d.name.trim(),
      price: d.price,
      stock: d.stock,
      description: typeof d.description === 'string' ? d.description.trim() || undefined : undefined,
      cogs,
      packagingCost,
    }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const product = await prisma.product.findFirst({
      where: { id: data.id },
      include: { business: true },
    })
    if (!product || product.business.userId !== session.user.id) throw new Error('Product not found or access denied')
    const cost: Record<string, number | null> = {}
    if (data.cogs !== undefined) cost.cogs = data.cogs
    if (data.packagingCost !== undefined) cost.packagingCost = data.packagingCost
    const updated = await prisma.product.update({
      where: { id: data.id },
      data: { name: data.name, price: data.price, stock: data.stock, description: data.description ?? null, ...cost },
    })
    enqueueProductReindex(updated.id)
    return {
      ...updated,
      price: updated.price.toNumber(),
      cogs: updated.cogs ? updated.cogs.toNumber() : null,
      packagingCost: updated.packagingCost ? updated.packagingCost.toNumber() : null,
    }
  })

export const deleteProduct = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).id !== 'string') {
      throw new Error('Invalid input')
    }
    return { id: (data as { id: string }).id }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const product = await prisma.product.findFirst({
      where: { id: data.id },
      include: { business: true },
    })
    if (!product || product.business.userId !== session.user.id) throw new Error('Product not found or access denied')
    await prisma.product.delete({ where: { id: data.id } })
    return { success: true }
  })
