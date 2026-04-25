import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { generateUniqueCode } from '#/lib/business-code'
import { auth } from '#/lib/auth'

async function requireSession() {
  const { getRequest } = await import('@tanstack/react-start/server')
  const session = await auth.api.getSession({ headers: getRequest().headers })
  if (!session) throw redirect({ to: '/login' })
  return session
}

type BusinessRow = {
  id: string
  name: string
  code: string
  mission: string | null
  userId: string
  platformFeePct: number | null
  defaultTransportCost: number | null
  createdAt: Date
  updatedAt: Date
}

function serializeBusiness(b: {
  id: string
  name: string
  code: string
  mission: string | null
  userId: string
  platformFeePct: { toNumber(): number } | number | null
  defaultTransportCost: { toNumber(): number } | number | null
  createdAt: Date
  updatedAt: Date
}): BusinessRow {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    mission: b.mission,
    userId: b.userId,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    platformFeePct: b.platformFeePct == null ? null : Number(b.platformFeePct),
    defaultTransportCost: b.defaultTransportCost == null ? null : Number(b.defaultTransportCost),
  }
}

export const fetchBusinesses = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await requireSession()
  const rows = await prisma.business.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(serializeBusiness)
})

async function requireBusinessOwner(businessId: string, userId: string) {
  const business = await prisma.business.findFirst({
    where: { id: businessId, userId },
  })
  if (!business) throw new Error('Business not found or access denied')
  return business
}

export const fetchBusinessSettings = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const business = await requireBusinessOwner(data.businessId, session.user.id)
    return {
      id: business.id,
      name: business.name,
      code: business.code,
      platformFeePct: business.platformFeePct ? Number(business.platformFeePct) : 0,
      defaultTransportCost: business.defaultTransportCost ? Number(business.defaultTransportCost) : 0,
    }
  })

export const updateBusinessSettings = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string') throw new Error('businessId required')
    if (typeof d.platformFeePct !== 'number' || d.platformFeePct < 0 || d.platformFeePct > 1) {
      throw new Error('platformFeePct must be a number between 0 and 1')
    }
    if (typeof d.defaultTransportCost !== 'number' || d.defaultTransportCost < 0) {
      throw new Error('defaultTransportCost must be a non-negative number')
    }
    return {
      businessId: d.businessId,
      platformFeePct: d.platformFeePct,
      defaultTransportCost: d.defaultTransportCost,
    }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const updated = await prisma.business.update({
      where: { id: data.businessId },
      data: {
        platformFeePct: data.platformFeePct,
        defaultTransportCost: data.defaultTransportCost,
      },
    })
    return {
      id: updated.id,
      name: updated.name,
      code: updated.code,
      platformFeePct: Number(updated.platformFeePct),
      defaultTransportCost: Number(updated.defaultTransportCost),
    }
  })

export const createBusiness = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).name !== 'string') {
      throw new Error('Invalid input')
    }
    const d = data as { name: string; mission?: string }
    if (d.name.trim().length < 2) throw new Error('Name must be at least 2 characters')
    return {
      name: d.name.trim(),
      mission: typeof d.mission === 'string' ? d.mission.trim() || undefined : undefined,
    }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    const code = await generateUniqueCode(data.name, async (c) => {
      const existing = await prisma.business.findUnique({ where: { code: c } })
      return existing !== null
    })
    const created = await prisma.business.create({
      data: { name: data.name, code, mission: data.mission, userId: session.user.id },
    })
    return serializeBusiness(created)
  })
