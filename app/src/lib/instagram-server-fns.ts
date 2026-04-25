import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'

const AGENTS_API_URL = process.env.AGENTS_API_URL ?? 'http://localhost:8000'

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

export interface InstagramStatus {
  connected: boolean
  username: string | null
  last_login_at: string | null
}

export const fetchInstagramStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }): Promise<InstagramStatus> => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const url = `${AGENTS_API_URL}/integrations/instagram/status?business_id=${encodeURIComponent(data.businessId)}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`Instagram status failed (${r.status})`)
    const payload = (await r.json()) as { connected: boolean; username?: string; last_login_at?: string }
    return {
      connected: payload.connected,
      username: payload.username ?? null,
      last_login_at: payload.last_login_at ?? null,
    }
  })

export const connectInstagram = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string' || d.businessId.trim().length === 0) throw new Error('businessId required')
    if (typeof d.username !== 'string' || d.username.trim().length === 0) throw new Error('username required')
    if (typeof d.password !== 'string' || d.password.length === 0) throw new Error('password required')
    return {
      businessId: d.businessId.trim(),
      username: d.username.trim(),
      password: d.password,
    }
  })
  .handler(async ({ data }): Promise<InstagramStatus> => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const r = await fetch(`${AGENTS_API_URL}/integrations/instagram/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: data.businessId,
        username: data.username,
        password: data.password,
      }),
    })
    if (!r.ok) {
      const text = await r.text()
      throw new Error(`Instagram login failed (${r.status}): ${text}`)
    }
    const payload = (await r.json()) as { connected: boolean; username?: string; last_login_at?: string }
    return {
      connected: payload.connected,
      username: payload.username ?? null,
      last_login_at: payload.last_login_at ?? null,
    }
  })

export const disconnectInstagram = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }): Promise<InstagramStatus> => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const r = await fetch(`${AGENTS_API_URL}/integrations/instagram/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: data.businessId }),
    })
    if (!r.ok) throw new Error(`Instagram logout failed (${r.status})`)
    const payload = (await r.json()) as { connected: boolean; username?: string; last_login_at?: string }
    return {
      connected: payload.connected,
      username: payload.username ?? null,
      last_login_at: payload.last_login_at ?? null,
    }
  })
