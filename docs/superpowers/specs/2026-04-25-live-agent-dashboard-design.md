# Live Agent Dashboard — Design

Status: approved in brainstorm 2026-04-25
Owner: atan branch

## Goal

Real-time dashboard showing every agent's activity in the Pisang Biru stack. Layout mirrors Paperclip AI dashboard: agent roster cards, KPI tiles, recent activity feed, recent tasks. Events persist so users can drill into an agent's reasoning and (when enabled) full LLM trace. Registry is scalable — adding a new agent is a one-file change.

## Non-goals

- Editing agent config from the UI.
- Multi-tenant admin panel. Business scoping piggybacks on existing Better Auth session.
- Replay / time-travel of past conversations.

## Architecture

```
agents (Python) ──emit_event──▶ postgres.agent_events (persist)
                 └──publish──▶ redis pub/sub ──▶ FastAPI SSE ──▶ browser EventSource
                                                                    │
                                   postgres ◀──GET /agent/events────┘ (history + drill-in)
```

- **Persistence**: every event writes to `agent_events` (append-only).
- **Live fanout**: same event published to Redis channel `agent.events`.
- **API**: FastAPI SSE endpoint subscribes to Redis, relays JSON frames. Degrades to polling if Redis unreachable.
- **Client**: TanStack Query `useInfiniteQuery` for history; `EventSource` listener merges live frames into the same query cache via `queryClient.setQueryData`. No separate client-state store.

## Data model (new Alembic migration)

```sql
CREATE TABLE agents (
  id         text PRIMARY KEY,          -- 'manager', 'customer_support'
  name       text NOT NULL,
  role       text NOT NULL,
  icon       text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE business_agents (
  business_id text NOT NULL,
  agent_id    text NOT NULL REFERENCES agents(id),
  enabled     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (business_id, agent_id)
);

CREATE TABLE agent_events (
  id              bigserial PRIMARY KEY,
  ts              timestamptz NOT NULL DEFAULT now(),
  agent_id        text NOT NULL,
  business_id     text,
  conversation_id text,
  task_id         text,
  kind            text NOT NULL,   -- node.start|node.end|handoff|message.in|message.out|error
  node            text,
  status          text,             -- ok|error|revise|escalate
  summary         text,
  reasoning       text,             -- evaluator verdict / rewrite notes
  trace           jsonb,            -- full LLM prompt/completion/tool_calls (gated)
  duration_ms     int,
  tokens_in       int,
  tokens_out      int
);
CREATE INDEX ix_events_agent_ts     ON agent_events (agent_id, ts DESC);
CREATE INDEX ix_events_biz_ts       ON agent_events (business_id, ts DESC);
CREATE INDEX ix_events_conversation ON agent_events (conversation_id, ts);
```

Retention: 30 days, pruned by Celery beat nightly. Partition by month if volume demands later.

## Agent registry (hybrid)

Each agent module declares:

```python
AGENT_META = {
    "id": "customer_support",
    "name": "Sales Assistant",
    "role": "Handles customer chat",
    "icon": "messages-square",
}
```

Boot hook scans `agents/app/agents/*.py`, upserts `AGENT_META` into `agents` table. Each seeded business gets a `business_agents` row per agent (enabled=true by default). Adding a new agent = new file with `AGENT_META` + events emitted; dashboard picks it up automatically.

## Event payload depth

- **Default**: id, ts, agent_id, business_id, conversation_id, task_id, kind, node, status, summary, duration_ms, tokens, `reasoning` (evaluator verdict / rewrite notes).
- **Trace gated**: `trace` jsonb (prompt, completion, tool_calls) written only if `TRACE_LLM=1`. Drill-in API returns trace only when env flag set AND session user has admin role.

## Event emission

Helper `agents/app/events.py`:

```python
def emit(agent_id, kind, *, conversation_id=None, task_id=None,
         business_id=None, node=None, status=None, summary=None,
         reasoning=None, trace=None, duration_ms=None,
         tokens_in=None, tokens_out=None) -> None:
    try:
        row = {...}
        db.execute(insert(agent_events).values(**row))
        redis.publish("agent.events", json.dumps(row, default=str))
    except Exception:
        log.exception("emit_event failed (swallowed)")
```

Wiring points:
- `@traced(agent_id, node_name)` decorator on every LangGraph node → `node.start` / `node.end` with `duration_ms`, `status`, `reasoning`.
- Dispatch node emits `kind='handoff'` on cross-agent routing.
- Inbound webhook + outbound send emit `message.in` / `message.out` with truncated body in `summary`.
- Global graph exception hook emits `kind='error'` with stacktrace in `trace`.

Emit never raises. Telemetry failure must not break agent execution.

## Infra

- Add `redis:7-alpine` to `docker-compose.yml`, port `6379`.
- `REDIS_URL` env var, documented in `agents/.env.example`.
- `redis.asyncio` client with connection pool + auto-reconnect.

## API surface

New router `agents/app/routers/events.py`. All endpoints scope by session `business_id`.

```
GET  /agent/registry
     → [{id, name, role, icon, enabled, status, current_task, stats_24h}]
     status derived: working (active event <60s) | idle | error (last event kind=error)

GET  /agent/events?agent_id=&conversation_id=&kind=&since=&limit=50
     → {items, next_cursor}  (keyset pagination on id DESC)

GET  /agent/events/{id}
     → full event; trace field only if TRACE_LLM=1 AND admin

GET  /agent/events/stream?agent_id=
     → text/event-stream. Frames: `event: agent.event\ndata: {...}\n\n`
     Heartbeat every 15s: `:ping\n\n`

GET  /agent/kpis?window=24h
     → {active_conversations, pending_approvals, escalation_rate, tokens_spent}
```

tRPC thin wrappers in `app/src/` expose history + registry + kpis as query hooks. SSE handled outside tRPC via raw `EventSource`.

## Frontend

Route: `/dashboard` (new). Components under `app/src/components/dashboard/`:

- `AgentRoster.tsx` — grid of `AgentCard`, driven by registry query.
- `AgentCard.tsx` — name, icon, status pill, current task one-liner, 24h throughput sparkline (recharts). Click → drawer.
- `KpiTiles.tsx` — 4 tiles: Active Conversations, Pending Approvals, Escalation Rate 24h, Tokens Spent 24h. SSE-triggered refetch debounced 1s.
- `ActivityFeed.tsx` — virtualized list (`react-virtuoso`), filter chips by agent, color bar per kind.
- `TaskList.tsx` — reuses existing inbox actions API with status chips (pending/approved/escalated).
- `EventDrawer.tsx` — shadcn `Sheet`, right slide-in. Tabs: Timeline (same `conversation_id`), Reasoning, Trace (hidden if none).
- Routes `/agents/$agentId` and `/events/$eventId` — full-page equivalents of card/drawer, deep-linkable.

Styling: shadcn + Tailwind, dark theme matching reference. Status colors: green working, zinc idle, amber revise, red error, violet escalate.

Live wire-up — `app/src/lib/agent-events-stream.ts`:
- Opens `EventSource('/agent/events/stream')` on dashboard mount.
- On frame → `queryClient.setQueryData(['events', filters], prepend)` + invalidate `['kpis']` debounced 1s.
- Reconnect exponential backoff (1s → 2s → 4s, cap 30s).
- 3 failures → switch to 5s polling; banner "Live updates paused, refreshing every 5s".

## Error handling

- Emit swallows all exceptions, logs them. Agent flow continues.
- Redis outage: Postgres writes land, SSE returns 503, client falls back to polling.
- Drawer race (event deleted by prune): empty state.
- Unknown `kind` in frame: render as generic row, no crash.

## Security

- All endpoints filter by session `business_id`. Cross-business read is a 404.
- `trace` returned only if `TRACE_LLM=1` AND admin role.
- SSE rate-limited to 1 concurrent stream per session.

## Testing

**Backend** (`agents/tests/`):
- `test_events_emit.py` — emit writes row + publishes; Redis-down path still persists.
- `test_events_api.py` — keyset pagination, filter combos, business scoping.
- `test_sse_stream.py` — publish → frame received; heartbeat cadence.
- `test_traced_decorator.py` — records duration + status on success/error.
- `test_registry_upsert.py` — boot scan idempotent.
- E2E extension of existing manager smoke: assert `agent_events` populated across revise→pass path.

**Frontend** (`app/src/__tests__/dashboard/`):
- `AgentCard` renders each status state.
- `ActivityFeed` merges SSE frame into query cache.
- Drawer loads on row click; shows/hides trace tab by permission.
- Reconnect falls back to polling after 3 failures.

## Open items

None — proceed to implementation plan.
