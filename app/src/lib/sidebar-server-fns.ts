// Sidebar agent roster source.
//
// Single source of truth: backend `/agent/registry` endpoint. That endpoint
// is populated at boot from every Python agent module's `AGENT_META`
// constant (see `agents/app/agents/registry.py`). To add a new agent the
// only required change is declaring `AGENT_META` in
// `agents/app/agents/<file>.py`; the sidebar will pick it up across every
// route automatically.
//
// We intentionally do NOT derive the roster from `agent_action` history —
// that misses agents that never produce actions of their own (e.g. the
// manager, which only critiques drafts).

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
  return business
}

const SIDEBAR_COLORS = ['#3b7ef8', '#00c97a', '#a78bfa', '#f59e0b', '#ef4444']

export interface SidebarAgent {
  id: string
  name: string
  color: string
  live: boolean
}

interface RegistryRow {
  id: string
  name: string
  role: string
  icon: string | null
  enabled: boolean
  status: 'idle' | 'working' | 'error'
  current_task: string | null
  stats_24h: { events: number }
}

const AGENTS_API_URL = process.env.AGENTS_API_URL ?? 'http://localhost:8000'

export const fetchSidebarAgents = createServerFn({ method: 'GET' })
  .inputValidator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).businessId !== 'string') {
      throw new Error('Invalid input')
    }
    return { businessId: (data as { businessId: string }).businessId }
  })
  .handler(async ({ data }): Promise<SidebarAgent[]> => {
    const session = await requireSession()
    await requireBusinessOwner(data.businessId, session.user.id)

    const url = `${AGENTS_API_URL}/agent/registry?business_id=${encodeURIComponent(data.businessId)}`
    let rows: RegistryRow[] = []
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`registry ${r.status}`)
      rows = (await r.json()) as RegistryRow[]
    } catch (err) {
      console.warn('fetchSidebarAgents: /agent/registry unreachable, returning empty roster', err)
      return []
    }

    return rows
      .filter((r) => r.enabled)
      .map((r, i) => ({
        id: r.id,
        name: r.name,
        color: SIDEBAR_COLORS[i % SIDEBAR_COLORS.length],
        live: r.status === 'working',
      }))
  })
