import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { prisma } from '#/db'
import { auth } from '#/lib/auth'

const AGENTS_API_URL = process.env.AGENTS_API_URL ?? process.env.AGENTS_URL ?? 'http://localhost:8000'

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

export interface MarketingRunResult {
  status: 'sent' | 'pending_approval'
  actionId: string | null
  reply: string | null
  confidence: number | null
  escalationSummary: string | null
}

export const runMarketingPost = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
    const d = data as Record<string, unknown>
    if (typeof d.businessId !== 'string' || d.businessId.trim().length === 0) {
      throw new Error('businessId required')
    }
    if (typeof d.prompt !== 'string' || d.prompt.trim().length === 0) {
      throw new Error('prompt required')
    }
    const count = typeof d.count === 'number' ? Math.floor(d.count) : 1
    if (!Number.isFinite(count) || count < 1 || count > 10) {
      throw new Error('count must be between 1 and 10')
    }
    return {
      businessId: d.businessId.trim(),
      prompt: d.prompt.trim(),
      count,
    }
  })
  .handler(async ({ data }): Promise<MarketingRunResult> => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const message = `please create ${data.count} instagram slides and post it. prompt: ${data.prompt}`
    const body = {
      business_id: data.businessId,
      customer_id: `marketing-${session.user.id}`,
      customer_phone: '+60100000000',
      message,
    }

    const r = await fetch(`${AGENTS_API_URL}/agent/support/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const text = await r.text()
      throw new Error(`Marketing run failed (${r.status}): ${text}`)
    }

    const payload = (await r.json()) as {
      status: 'sent' | 'pending_approval'
      action_id?: string
      reply?: string
      confidence?: number
      escalation_summary?: string
    }
    return {
      status: payload.status,
      actionId: payload.action_id ?? null,
      reply: payload.reply ?? null,
      confidence: payload.confidence ?? null,
      escalationSummary: payload.escalation_summary ?? null,
    }
  })
