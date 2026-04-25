const BASE =
  (import.meta.env.VITE_AGENTS_BASE_URL as string | undefined) ??
  'http://localhost:8000'

export type AgentEventKind =
  | 'node.start'
  | 'node.end'
  | 'handoff'
  | 'message.in'
  | 'message.out'
  | 'error'

export type AgentEventStatus =
  | 'ok'
  | 'error'
  | 'revise'
  | 'rewrite'
  | 'escalate'
  | null

export interface AgentRow {
  id: string
  name: string
  role: string
  icon: string | null
  enabled: boolean
  status: 'idle' | 'working' | 'error'
  current_task: string | null
  stats_24h: { events: number }
}

export interface AgentEvent {
  id: number
  ts: string
  agent_id: string
  business_id: string | null
  conversation_id: string | null
  task_id: string | null
  kind: AgentEventKind
  node: string | null
  status: AgentEventStatus
  summary: string | null
  reasoning: string | null
  duration_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
  trace?: unknown
}

export interface Kpis {
  active_conversations: number
  pending_approvals: number
  escalation_rate: number
  tokens_spent: number
}

async function jget<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) qs.set(k, String(v))
  })
  const url = `${BASE}${path}${qs.toString() ? `?${qs}` : ''}`
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`${path} ${r.status}`)
  return (await r.json()) as T
}

export const agentApi = {
  registry: (businessId: string) =>
    jget<AgentRow[]>('/agent/registry', { business_id: businessId }),
  events: (p: {
    businessId: string
    agentId?: string
    conversationId?: string
    kind?: string
    before?: number
    limit?: number
  }) =>
    jget<{ items: AgentEvent[]; next_cursor: number | null }>(
      '/agent/events',
      {
        business_id: p.businessId,
        agent_id: p.agentId,
        conversation_id: p.conversationId,
        kind: p.kind,
        before: p.before,
        limit: p.limit ?? 50,
      },
    ),
  event: (id: number, businessId: string) =>
    jget<AgentEvent>(`/agent/events/${id}`, { business_id: businessId }),
  kpis: (businessId: string) =>
    jget<Kpis>('/agent/kpis', { business_id: businessId }),
}
