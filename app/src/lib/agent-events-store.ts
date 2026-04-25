import type { QueryClient } from '@tanstack/react-query'
import type { AgentEvent } from './agent-api'

const MAX_BUFFER = 200

export type EventFilters = {
  businessId: string
  agentId?: string
  conversationId?: string
  kind?: string
}

type CachedPage = { items: AgentEvent[]; next_cursor: number | null }
type CachedQuery = { pages: CachedPage[]; pageParams: Array<number | undefined> }

function matchesFilters(ev: AgentEvent, f: EventFilters): boolean {
  if (f.agentId && ev.agent_id !== f.agentId) return false
  if (f.conversationId && ev.conversation_id !== f.conversationId) return false
  if (f.kind && ev.kind !== f.kind) return false
  return true
}

export function prependEvent(
  qc: QueryClient,
  filters: EventFilters,
  ev: AgentEvent,
): void {
  if (!matchesFilters(ev, filters)) return

  qc.setQueryData<CachedQuery>(['events', filters], (old) => {
    if (!old) {
      return {
        pages: [{ items: [ev], next_cursor: null }],
        pageParams: [undefined],
      }
    }
    const first = old.pages[0]
    const merged = [ev, ...first.items].slice(0, MAX_BUFFER)
    return {
      ...old,
      pages: [{ ...first, items: merged }, ...old.pages.slice(1)],
    }
  })
}
