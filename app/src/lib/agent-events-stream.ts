import type { AgentEvent } from './agent-api'

type Opts = {
  businessId: string
  agentId?: string
  onEvent: (ev: AgentEvent) => void
  onConnect: () => void
  onFallback: () => void
}

const BASE =
  (import.meta.env.VITE_AGENTS_BASE_URL as string | undefined) ??
  'http://localhost:8000'

const MAX_FAILS = 3
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]

export function openAgentEventStream(opts: Opts) {
  let fails = 0
  let closed = false
  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect() {
    if (closed) return
    const qs = new URLSearchParams({ business_id: opts.businessId })
    if (opts.agentId) qs.set('agent_id', opts.agentId)
    es = new EventSource(`${BASE}/agent/events/stream?${qs}`, {
      withCredentials: true,
    })
    es.onopen = () => {
      fails = 0
      opts.onConnect()
    }
    es.onmessage = (e) => {
      try {
        opts.onEvent(JSON.parse(e.data) as AgentEvent)
      } catch {
        // ignore malformed frame
      }
    }
    // Server emits `event: agent.event\ndata: ...`. EventSource only fires
    // onmessage for default-named events; register a named listener too.
    es.addEventListener('agent.event', (e: MessageEvent) => {
      try {
        opts.onEvent(JSON.parse(e.data) as AgentEvent)
      } catch {
        // ignore
      }
    })
    es.onerror = () => {
      es?.close()
      es = null
      fails += 1
      if (fails >= MAX_FAILS) {
        opts.onFallback()
        return
      }
      const delay = BACKOFF_MS[Math.min(fails - 1, BACKOFF_MS.length - 1)]
      reconnectTimer = setTimeout(connect, delay)
    }
  }
  connect()

  return {
    close() {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      es?.close()
    },
  }
}
