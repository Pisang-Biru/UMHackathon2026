import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'
import { coerceWhatsappStatus } from '#/lib/whatsapp-status'

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

const WHATSAPP_BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL ?? 'http://localhost:3100'

async function bridgeFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${WHATSAPP_BRIDGE_URL}${path}`, init)
  if (!response.ok) {
    throw new Error(`WhatsApp bridge error: ${response.status}`)
  }
  return response.json()
}

export const fetchWhatsappStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    try {
      const payload = await bridgeFetch(`/sessions/${encodeURIComponent(data.businessId)}/status`)
      return coerceWhatsappStatus(payload)
    } catch (error) {
      return coerceWhatsappStatus({
        status: 'error',
        detail: error instanceof Error ? error.message : 'WhatsApp bridge unavailable',
      })
    }
  })

export const startWhatsappPairing = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const payload = await bridgeFetch(`/sessions/${encodeURIComponent(data.businessId)}/pair`, {
      method: 'POST',
    })
    return coerceWhatsappStatus(payload)
  })

export const disconnectWhatsapp = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }) => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)
    const payload = await bridgeFetch(`/sessions/${encodeURIComponent(data.businessId)}/disconnect`, {
      method: 'POST',
    })
    return coerceWhatsappStatus(payload)
  })
