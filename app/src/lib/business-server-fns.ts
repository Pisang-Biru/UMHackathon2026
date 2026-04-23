import { createServerFn } from '@tanstack/react-start'
import { prisma } from '#/db'
import { generateUniqueCode } from '#/lib/business-code'

export const fetchBusinesses = createServerFn({ method: 'GET' }).handler(async () => {
  return prisma.business.findMany({ orderBy: { createdAt: 'asc' } })
})

export const createBusiness = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    const d = data as { name: string; mission?: string }
    if (!d.name || d.name.trim().length < 2) throw new Error('Name must be at least 2 characters')
    return { name: d.name.trim(), mission: d.mission?.trim() || undefined }
  })
  .handler(async ({ data }) => {
    const code = await generateUniqueCode(data.name, async (c) => {
      const existing = await prisma.business.findUnique({ where: { code: c } })
      return existing !== null
    })

    return prisma.business.create({
      data: { name: data.name, code, mission: data.mission },
    })
  })
