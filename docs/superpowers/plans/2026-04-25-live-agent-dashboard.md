# Live Agent Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time dashboard that streams per-agent activity, with drill-in into reasoning + (optional) LLM trace, scalable to new agents.

**Architecture:** Agents emit events via a helper that dual-writes to Postgres (`agent_events`) and Redis pub/sub. FastAPI exposes an SSE endpoint that relays Redis frames to the browser, plus REST endpoints for history / KPIs / registry. Frontend uses TanStack Query for cache; a single `EventSource` listener merges live frames into the query cache. Registry is hybrid: each agent module exports `AGENT_META`, which the API upserts into `agents` at boot.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy + Alembic, Celery, `redis.asyncio`, LangGraph; TanStack Start + TanStack Query, tRPC, shadcn/ui + Tailwind, recharts, react-virtuoso.

**Spec:** `docs/superpowers/specs/2026-04-25-live-agent-dashboard-design.md`

---

## File Structure

### Backend (`agents/`)

- Create: `agents/app/events.py` — `emit()` helper (dual-write), Redis client factory, SSE pubsub subscription helper.
- Create: `agents/alembic/versions/0004_agent_events.py` — migration for `agents`, `business_agents`, `agent_events` tables.
- Create: `agents/app/routers/events.py` — `/agent/registry`, `/agent/events`, `/agent/events/{id}`, `/agent/events/stream`, `/agent/kpis`.
- Create: `agents/app/agents/registry.py` — `AGENT_META` scanner + boot upsert.
- Create: `agents/app/agents/_traced.py` — `@traced(agent_id, node)` decorator wrapping LangGraph nodes.
- Create: `agents/app/worker/prune.py` — nightly `agent_events` retention.
- Modify: `agents/app/main.py` — include new router, run registry upsert at startup.
- Modify: `agents/app/db.py` — add ORM classes `Agent`, `BusinessAgent`, `AgentEvent`.
- Modify: `agents/app/agents/customer_support.py` — add `AGENT_META`, wrap nodes with `@traced`, emit message/handoff events.
- Modify: `agents/app/agents/manager.py` + `manager_evaluator.py`, `manager_rewrite.py`, `manager_terminal.py` — add `AGENT_META`, wrap nodes with `@traced`, emit handoff/error events.
- Modify: `docker-compose.yml` — add `redis:7-alpine` service + `REDIS_URL` env var on agents services.
- Modify: `agents/.env.example` — document `REDIS_URL`, `TRACE_LLM`.
- Modify: `agents/requirements.txt` — add `redis>=5.0`.
- Modify: `agents/app/worker/__init__.py` (or wherever beat schedule lives) — register prune task.
- Tests: `agents/tests/test_events_emit.py`, `test_events_api.py`, `test_sse_stream.py`, `test_traced_decorator.py`, `test_registry_upsert.py`, `test_kpis.py`, `test_prune.py`.

### Frontend (`app/`)

- Create: `app/src/routes/dashboard.tsx` — top-level dashboard route.
- Create: `app/src/routes/agents.$agentId.tsx` — per-agent detail page.
- Create: `app/src/routes/events.$eventId.tsx` — single-event detail page.
- Create: `app/src/components/dashboard/AgentRoster.tsx`
- Create: `app/src/components/dashboard/AgentCard.tsx`
- Create: `app/src/components/dashboard/KpiTiles.tsx`
- Create: `app/src/components/dashboard/ActivityFeed.tsx`
- Create: `app/src/components/dashboard/TaskList.tsx`
- Create: `app/src/components/dashboard/EventDrawer.tsx`
- Create: `app/src/components/dashboard/ConnectionBanner.tsx`
- Create: `app/src/lib/agent-events-stream.ts` — `EventSource` wrapper + reconnect/fallback.
- Create: `app/src/lib/agent-api.ts` — typed fetchers for `/agent/registry`, `/agent/events`, `/agent/kpis`.
- Create: `app/src/lib/agent-events-store.ts` — tiny helper to `setQueryData` prepend + cap buffer at 200.
- Tests: `app/src/__tests__/dashboard/AgentCard.test.tsx`, `ActivityFeed.test.tsx`, `EventDrawer.test.tsx`, `stream-reconnect.test.ts`.

---

## Phase 1 — Infra

### Task 1: Redis service in docker-compose

**Files:**
- Modify: `docker-compose.yml`
- Modify: `agents/.env.example`
- Modify: `agents/requirements.txt`

- [ ] **Step 1: Add Redis service to compose**

Edit `docker-compose.yml`, add new service under `services:` and extend `x-agents-env`:

```yaml
x-agents-env: &agents-env
  DATABASE_URL: postgresql://postgres:root@postgres:5432/pisangbisnes
  CELERY_BROKER_URL: amqp://guest:guest@rabbitmq:5672//
  REDIS_URL: redis://redis:6379/0
  EMBED_MODEL: BAAI/bge-m3
  # ... (rest unchanged)

services:
  # ... postgres, rabbitmq ...
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 20
```

Add `redis` to `depends_on:` of `agents-api`, `agents-worker`, `agents-beat` with `condition: service_healthy`.

- [ ] **Step 2: Document env var**

Append to `agents/.env.example`:

```
# Redis for agent event pub/sub
REDIS_URL=redis://localhost:6379/0

# Enable full LLM prompt/completion capture in agent_events.trace (admin-only API read)
TRACE_LLM=0
```

- [ ] **Step 3: Add redis dep**

Append to `agents/requirements.txt`:

```
redis>=5.0
```

- [ ] **Step 4: Smoke-test redis is reachable from agents container**

Run:

```bash
./scripts/dev.sh down && ./scripts/dev.sh up
docker compose exec agents-api python -c "import redis; r=redis.Redis.from_url('redis://redis:6379/0'); print(r.ping())"
```

Expected: `True`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml agents/.env.example agents/requirements.txt
git commit -m "feat(infra): add redis service for agent event pub/sub"
```

---

### Task 2: Alembic migration — agents, business_agents, agent_events

**Files:**
- Create: `agents/alembic/versions/0004_agent_events.py`

- [ ] **Step 1: Write migration**

```python
"""agent events, registry, business enablement
Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "agents",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
    )

    op.create_table(
        "business_agents",
        sa.Column("business_id", sa.Text(), nullable=False),
        sa.Column("agent_id", sa.Text(), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("business_id", "agent_id"),
    )

    op.create_table(
        "agent_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("ts", sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("business_id", sa.Text(), nullable=True),
        sa.Column("conversation_id", sa.Text(), nullable=True),
        sa.Column("task_id", sa.Text(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("node", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("trace", sa.dialects.postgresql.JSONB(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
    )
    op.create_index("ix_events_agent_ts", "agent_events", ["agent_id", sa.text("ts DESC")])
    op.create_index("ix_events_biz_ts", "agent_events", ["business_id", sa.text("ts DESC")])
    op.create_index("ix_events_conversation", "agent_events", ["conversation_id", "ts"])


def downgrade():
    op.drop_index("ix_events_conversation", table_name="agent_events")
    op.drop_index("ix_events_biz_ts", table_name="agent_events")
    op.drop_index("ix_events_agent_ts", table_name="agent_events")
    op.drop_table("agent_events")
    op.drop_table("business_agents")
    op.drop_table("agents")
```

- [ ] **Step 2: Run migration**

```bash
./scripts/dev.sh shell -c "alembic upgrade head"
```

Expected: `Running upgrade 0003 -> 0004, agent events, registry, business enablement`.

- [ ] **Step 3: Verify tables**

```bash
./scripts/dev.sh psql -c "\d agents" -c "\d agent_events"
```

Expected: all columns listed, indexes present.

- [ ] **Step 4: Commit**

```bash
git add agents/alembic/versions/0004_agent_events.py
git commit -m "feat(db): add agents, business_agents, agent_events tables"
```

---

### Task 3: ORM models in db.py

**Files:**
- Modify: `agents/app/db.py`
- Test: `agents/tests/test_events_models.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_events_models.py`:

```python
from datetime import datetime, timezone
from app.db import SessionLocal, Agent, BusinessAgent, AgentEvent


def test_can_insert_agent_and_event():
    with SessionLocal() as s:
        s.add(Agent(id="t_agent", name="Test", role="tester", icon=None))
        s.add(BusinessAgent(business_id="dev-biz", agent_id="t_agent", enabled=True))
        s.add(AgentEvent(
            agent_id="t_agent", business_id="dev-biz",
            conversation_id="c1", kind="node.start", node="nodeA",
            status="ok", summary="hello", duration_ms=12,
        ))
        s.commit()
        row = s.query(AgentEvent).filter_by(agent_id="t_agent").one()
        assert row.summary == "hello"
        assert row.ts is not None
        s.query(AgentEvent).filter_by(agent_id="t_agent").delete()
        s.query(BusinessAgent).filter_by(agent_id="t_agent").delete()
        s.query(Agent).filter_by(id="t_agent").delete()
        s.commit()
```

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_models.py -v"
```

Expected: `ImportError: cannot import name 'Agent'`.

- [ ] **Step 3: Add ORM classes**

Append to `agents/app/db.py` (near existing `AgentAction`):

```python
from sqlalchemy import BigInteger, Boolean, Text, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped["datetime"] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class BusinessAgent(Base):
    __tablename__ = "business_agents"
    business_id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(
        Text, ForeignKey("agents.id"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AgentEvent(Base):
    __tablename__ = "agent_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped["datetime"] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    business_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    conversation_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    node: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    trace: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

If existing `db.py` uses the classical `Base` + `Column` style instead of Mapped, mirror that style instead.

- [ ] **Step 4: Run test, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_models.py -v"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/app/db.py agents/tests/test_events_models.py
git commit -m "feat(db): ORM models for Agent, BusinessAgent, AgentEvent"
```

---

## Phase 2 — Emit helper

### Task 4: `emit()` helper with dual-write

**Files:**
- Create: `agents/app/events.py`
- Test: `agents/tests/test_events_emit.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_events_emit.py`:

```python
import json
from unittest.mock import MagicMock, patch
from app import events
from app.db import SessionLocal, AgentEvent


def test_emit_writes_row_and_publishes():
    fake_redis = MagicMock()
    with patch.object(events, "_redis", fake_redis):
        events.emit(
            agent_id="customer_support",
            kind="node.end",
            business_id="dev-biz",
            conversation_id="c1",
            node="draft",
            status="ok",
            summary="drafted reply",
            duration_ms=42,
        )
    with SessionLocal() as s:
        row = s.query(AgentEvent).filter_by(conversation_id="c1").order_by(AgentEvent.id.desc()).first()
        assert row and row.node == "draft" and row.status == "ok"
    fake_redis.publish.assert_called_once()
    ch, payload = fake_redis.publish.call_args.args
    assert ch == "agent.events"
    data = json.loads(payload)
    assert data["agent_id"] == "customer_support"


def test_emit_swallows_redis_failure():
    fake_redis = MagicMock()
    fake_redis.publish.side_effect = RuntimeError("redis down")
    with patch.object(events, "_redis", fake_redis):
        events.emit(agent_id="x", kind="node.start", conversation_id="c-redis-fail")
    with SessionLocal() as s:
        row = s.query(AgentEvent).filter_by(conversation_id="c-redis-fail").first()
        assert row is not None


def test_emit_swallows_db_failure(monkeypatch):
    def boom():
        raise RuntimeError("db down")
    monkeypatch.setattr(events, "_session_factory", boom)
    events.emit(agent_id="x", kind="node.start", conversation_id="c-db-fail")
```

- [ ] **Step 2: Run test, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_emit.py -v"
```

Expected: `ModuleNotFoundError: No module named 'app.events'`.

- [ ] **Step 3: Implement helper**

Create `agents/app/events.py`:

```python
import os
import json
import logging
from datetime import datetime
from typing import Any, Optional

import redis
from sqlalchemy import insert

from app.db import SessionLocal, AgentEvent

log = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_CHANNEL = "agent.events"

_redis: Optional[redis.Redis] = None
_session_factory = SessionLocal


def _get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.Redis.from_url(REDIS_URL, socket_timeout=2, socket_connect_timeout=2)
    return _redis


def _serialize(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"not serializable: {type(obj)}")


def emit(
    agent_id: str,
    kind: str,
    *,
    conversation_id: Optional[str] = None,
    task_id: Optional[str] = None,
    business_id: Optional[str] = None,
    node: Optional[str] = None,
    status: Optional[str] = None,
    summary: Optional[str] = None,
    reasoning: Optional[str] = None,
    trace: Optional[dict] = None,
    duration_ms: Optional[int] = None,
    tokens_in: Optional[int] = None,
    tokens_out: Optional[int] = None,
) -> None:
    """Dual-write an agent event to Postgres + Redis. Never raises."""
    row: dict[str, Any] = {
        "agent_id": agent_id,
        "kind": kind,
        "conversation_id": conversation_id,
        "task_id": task_id,
        "business_id": business_id,
        "node": node,
        "status": status,
        "summary": summary,
        "reasoning": reasoning,
        "trace": trace,
        "duration_ms": duration_ms,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }

    row_id: Optional[int] = None
    ts_iso: Optional[str] = None
    try:
        with _session_factory() as s:
            result = s.execute(
                insert(AgentEvent).values(**row).returning(AgentEvent.id, AgentEvent.ts)
            )
            row_id, ts = result.one()
            ts_iso = ts.isoformat() if ts else None
            s.commit()
    except Exception:
        log.exception("emit_event: DB write failed (swallowed)")

    try:
        payload = {"id": row_id, "ts": ts_iso, **row}
        (_redis or _get_redis()).publish(_CHANNEL, json.dumps(payload, default=_serialize))
    except Exception:
        log.exception("emit_event: Redis publish failed (swallowed)")
```

- [ ] **Step 4: Run tests, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_emit.py -v"
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/events.py agents/tests/test_events_emit.py
git commit -m "feat(events): emit() helper with Postgres + Redis dual-write"
```

---

### Task 5: `@traced` decorator for LangGraph nodes

**Files:**
- Create: `agents/app/agents/_traced.py`
- Test: `agents/tests/test_traced_decorator.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_traced_decorator.py`:

```python
from unittest.mock import patch
from app.agents._traced import traced


def test_traced_emits_start_and_end_on_success():
    calls = []
    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="test_agent", node="nodeA")
        def node_fn(state):
            return {"x": 1}
        out = node_fn({"business_id": "b", "conversation_id": "c"})

    assert out == {"x": 1}
    kinds = [k for k, _ in calls]
    assert kinds == ["node.start", "node.end"]
    assert calls[1][1]["status"] == "ok"
    assert calls[1][1]["duration_ms"] is not None


def test_traced_emits_error_on_exception():
    calls = []
    def fake_emit(agent_id, kind, **kw):
        calls.append((kind, kw))

    with patch("app.agents._traced.emit", side_effect=fake_emit):
        @traced(agent_id="test_agent", node="nodeA")
        def node_fn(state):
            raise ValueError("boom")
        try:
            node_fn({"business_id": "b", "conversation_id": "c"})
        except ValueError:
            pass

    assert calls[-1][0] == "node.end"
    assert calls[-1][1]["status"] == "error"
    assert "boom" in (calls[-1][1]["summary"] or "")
```

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_traced_decorator.py -v"
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement decorator**

Create `agents/app/agents/_traced.py`:

```python
import os
import time
import functools
from typing import Callable, Any

from app.events import emit

TRACE_LLM = os.getenv("TRACE_LLM", "0") == "1"


def traced(agent_id: str, node: str) -> Callable:
    """Wrap a LangGraph node fn to emit node.start/node.end events.

    Node functions have signature (state: dict) -> dict. We pull
    business_id / conversation_id / customer_id from the state for event scoping.
    """
    def decorator(fn: Callable[[dict], dict]) -> Callable[[dict], dict]:
        @functools.wraps(fn)
        def wrapper(state: dict) -> dict:
            biz = state.get("business_id")
            conv = state.get("conversation_id") or state.get("customer_id")
            emit(agent_id=agent_id, kind="node.start",
                 business_id=biz, conversation_id=conv, node=node)
            start = time.perf_counter()
            try:
                out = fn(state)
                dur = int((time.perf_counter() - start) * 1000)
                # Extract post-run signals: verdict / final_action / critique
                status = "ok"
                reasoning = None
                if isinstance(out, dict):
                    if out.get("verdict") in ("revise", "rewrite", "escalate"):
                        status = out["verdict"]
                    if out.get("final_action") == "escalate":
                        status = "escalate"
                    crit = out.get("critique")
                    if crit and hasattr(crit, "model_dump"):
                        reasoning = (crit.model_dump().get("notes") or None)
                emit(agent_id=agent_id, kind="node.end",
                     business_id=biz, conversation_id=conv, node=node,
                     status=status, reasoning=reasoning, duration_ms=dur)
                return out
            except Exception as e:
                dur = int((time.perf_counter() - start) * 1000)
                emit(agent_id=agent_id, kind="node.end",
                     business_id=biz, conversation_id=conv, node=node,
                     status="error", summary=f"{type(e).__name__}: {e}",
                     duration_ms=dur)
                raise
        return wrapper
    return decorator
```

- [ ] **Step 4: Run tests, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_traced_decorator.py -v"
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add agents/app/agents/_traced.py agents/tests/test_traced_decorator.py
git commit -m "feat(events): @traced decorator wraps LangGraph nodes"
```

---

## Phase 3 — Registry

### Task 6: Agent registry scanner + boot upsert

**Files:**
- Create: `agents/app/agents/registry.py`
- Modify: `agents/app/agents/customer_support.py` — add `AGENT_META`.
- Modify: `agents/app/agents/manager.py` — add `AGENT_META`.
- Modify: `agents/app/main.py` — call `upsert_registry()` on startup.
- Test: `agents/tests/test_registry_upsert.py`

- [ ] **Step 1: Add AGENT_META to customer_support**

At top of `agents/app/agents/customer_support.py` (after imports):

```python
AGENT_META = {
    "id": "customer_support",
    "name": "Sales Assistant",
    "role": "Handles customer chat end-to-end",
    "icon": "messages-square",
}
```

- [ ] **Step 2: Add AGENT_META to manager**

At top of `agents/app/agents/manager.py` (after imports):

```python
AGENT_META = {
    "id": "manager",
    "name": "Manager",
    "role": "Reviews and refines sales replies",
    "icon": "brain",
}
```

- [ ] **Step 3: Write failing test**

Create `agents/tests/test_registry_upsert.py`:

```python
from app.agents.registry import discover_agent_meta, upsert_registry
from app.db import SessionLocal, Agent, BusinessAgent


def test_discover_includes_both_agents():
    metas = {m["id"]: m for m in discover_agent_meta()}
    assert "customer_support" in metas
    assert "manager" in metas
    assert metas["customer_support"]["name"] == "Sales Assistant"


def test_upsert_idempotent():
    upsert_registry(business_ids=["dev-biz"])
    upsert_registry(business_ids=["dev-biz"])  # second call must not error

    with SessionLocal() as s:
        assert s.query(Agent).filter_by(id="manager").count() == 1
        assert s.query(BusinessAgent).filter_by(
            business_id="dev-biz", agent_id="manager"
        ).count() == 1
```

- [ ] **Step 4: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_registry_upsert.py -v"
```

Expected: ModuleNotFoundError.

- [ ] **Step 5: Implement registry**

Create `agents/app/agents/registry.py`:

```python
import importlib
import pkgutil
import logging
from typing import Iterable

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import SessionLocal, Agent, BusinessAgent, Business
import app.agents as agents_pkg

log = logging.getLogger(__name__)


def discover_agent_meta() -> list[dict]:
    """Scan app.agents.* modules for AGENT_META dicts."""
    metas: list[dict] = []
    for info in pkgutil.iter_modules(agents_pkg.__path__):
        if info.name.startswith("_") or info.name in ("base", "registry", "example"):
            continue
        mod = importlib.import_module(f"app.agents.{info.name}")
        meta = getattr(mod, "AGENT_META", None)
        if isinstance(meta, dict) and "id" in meta:
            metas.append(meta)
    # dedupe by id (manager.py and helpers may share via re-exports)
    seen: dict[str, dict] = {}
    for m in metas:
        seen[m["id"]] = m
    return list(seen.values())


def upsert_registry(business_ids: Iterable[str] | None = None) -> None:
    metas = discover_agent_meta()
    if not metas:
        log.warning("upsert_registry: no AGENT_META found")
        return

    with SessionLocal() as s:
        for m in metas:
            stmt = pg_insert(Agent).values(
                id=m["id"], name=m["name"], role=m["role"], icon=m.get("icon")
            ).on_conflict_do_update(
                index_elements=[Agent.id],
                set_={"name": m["name"], "role": m["role"], "icon": m.get("icon")},
            )
            s.execute(stmt)

        biz_ids = list(business_ids) if business_ids else [b.id for b in s.query(Business).all()]
        for bid in biz_ids:
            for m in metas:
                stmt = pg_insert(BusinessAgent).values(
                    business_id=bid, agent_id=m["id"], enabled=True
                ).on_conflict_do_nothing()
                s.execute(stmt)
        s.commit()
    log.info("upsert_registry: upserted %d agents across %d businesses", len(metas), len(biz_ids))
```

- [ ] **Step 6: Wire startup hook**

In `agents/app/main.py`, add after `app = FastAPI(...)`:

```python
from app.agents.registry import upsert_registry

@app.on_event("startup")
def _boot_registry():
    try:
        upsert_registry()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("registry upsert failed")
```

- [ ] **Step 7: Run tests, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_registry_upsert.py -v"
```

Expected: 2 passed.

- [ ] **Step 8: Commit**

```bash
git add agents/app/agents/registry.py agents/app/agents/customer_support.py agents/app/agents/manager.py agents/app/main.py agents/tests/test_registry_upsert.py
git commit -m "feat(agents): AGENT_META registry + boot upsert"
```

---

## Phase 4 — Wire emit into existing agents

### Task 7: Wrap customer_support nodes with @traced + emit messages

**Files:**
- Modify: `agents/app/agents/customer_support.py`
- Test: `agents/tests/test_customer_support_traced.py`

- [ ] **Step 1: Inspect existing node names**

```bash
grep -n "add_node\|def.*state" agents/app/agents/customer_support.py | head -20
```

Note each node name (e.g., `draft`, `send`, `tool_call`). These are the targets.

- [ ] **Step 2: Write failing test**

Create `agents/tests/test_customer_support_traced.py`:

```python
from unittest.mock import patch
from app.db import SessionLocal, AgentEvent


def test_support_graph_emits_events_per_node(seeded_business, fake_llm):
    """End-to-end: running support graph produces node.start/node.end events."""
    from app.agents.customer_support import build_customer_support_agent
    graph = build_customer_support_agent(fake_llm)
    graph.invoke({
        "business_id": seeded_business.id,
        "customer_id": "c-test-1",
        "customer_phone": "+60111111111",
        "messages": [],
    })
    with SessionLocal() as s:
        evs = s.query(AgentEvent).filter_by(
            agent_id="customer_support", conversation_id="c-test-1"
        ).order_by(AgentEvent.id).all()
    kinds = [e.kind for e in evs]
    assert "node.start" in kinds and "node.end" in kinds
    s.query(AgentEvent).filter_by(conversation_id="c-test-1").delete()
    s.commit()
```

If `seeded_business`/`fake_llm` fixtures don't exist, check `agents/tests/conftest.py` for existing fixtures used by `test_manager_graph.py` and copy the pattern.

- [ ] **Step 3: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_customer_support_traced.py -v"
```

Expected: no events in DB / assertion fails.

- [ ] **Step 4: Wrap node functions**

In `customer_support.py`, import:

```python
from app.agents._traced import traced
```

For each `def node_fn(state):` that gets passed to `graph.add_node("name", node_fn)`, wrap at add-site:

```python
g.add_node("draft", traced(agent_id="customer_support", node="draft")(draft_node))
```

Do this for every `add_node(...)` call.

- [ ] **Step 5: Emit message.in/message.out at entry/exit**

If there is a clear entry node (first node after START) add at its top:

```python
from app.events import emit
emit(agent_id="customer_support", kind="message.in",
     business_id=state.get("business_id"),
     conversation_id=state.get("customer_id"),
     summary=(state.get("messages") or [{}])[-1].get("content", "")[:200])
```

At the send-reply node, after sending:

```python
emit(agent_id="customer_support", kind="message.out",
     business_id=state["business_id"], conversation_id=state["customer_id"],
     summary=(reply_text or "")[:200])
```

- [ ] **Step 6: Run test, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_customer_support_traced.py -v"
```

Expected: PASS.

- [ ] **Step 7: Run existing support tests to ensure no regression**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/ -v -k 'support or customer'"
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add agents/app/agents/customer_support.py agents/tests/test_customer_support_traced.py
git commit -m "feat(events): trace customer_support nodes + message events"
```

---

### Task 8: Wrap manager nodes + emit handoff/escalate

**Files:**
- Modify: `agents/app/agents/manager.py`, `manager_evaluator.py`, `manager_rewrite.py`, `manager_terminal.py`
- Test: `agents/tests/test_manager_traced.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_manager_traced.py`:

```python
from app.db import SessionLocal, AgentEvent


def test_manager_graph_emits_handoff_and_nodes(seeded_business, fake_llm_manager_pass):
    from app.agents.manager import build_manager_graph
    graph = build_manager_graph(jual_llm=fake_llm_manager_pass, manager_llm=fake_llm_manager_pass)
    graph.invoke({
        "business_id": seeded_business.id,
        "customer_id": "c-mgr-1",
        "customer_phone": "+60222222222",
        "messages": [],
        "iterations": [],
    })
    with SessionLocal() as s:
        evs = s.query(AgentEvent).filter_by(conversation_id="c-mgr-1").order_by(AgentEvent.id).all()
    kinds = [(e.agent_id, e.kind, e.node) for e in evs]
    assert any(k[0] == "manager" for k in kinds)
    assert any(k[1] == "handoff" for k in kinds)
    s.query(AgentEvent).filter_by(conversation_id="c-mgr-1").delete()
    s.commit()
```

Reuse `fake_llm_manager_pass` fixture from existing manager smoke tests (`agents/tests/test_manager_graph_smoke.py` or similar).

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_manager_traced.py -v"
```

Expected: FAIL.

- [ ] **Step 3: Wrap nodes in manager.py**

At every `g.add_node("NAME", fn)` call in `manager.py`:

```python
from app.agents._traced import traced
g.add_node("load_shared_context", traced(agent_id="manager", node="load_shared_context")(_load_shared_context_impl))
g.add_node("dispatch", traced(agent_id="manager", node="dispatch")(dispatch_node))
g.add_node("evaluate", traced(agent_id="manager", node="evaluate")(evaluate_node))
g.add_node("rewrite", traced(agent_id="manager", node="rewrite")(rewrite_node))
g.add_node("finalize", traced(agent_id="manager", node="finalize")(finalize_node))
g.add_node("queue_for_human", traced(agent_id="manager", node="queue_for_human")(queue_node))
```

Adjust names to match actual graph wiring.

- [ ] **Step 4: Emit handoff on dispatch**

In the dispatch node (where manager calls into customer_support subgraph), after invoking the subgraph:

```python
from app.events import emit
emit(agent_id="manager", kind="handoff",
     business_id=state["business_id"], conversation_id=state.get("customer_id"),
     summary="manager → customer_support (draft request)")
# ... invoke support subgraph ...
emit(agent_id="customer_support", kind="handoff",
     business_id=state["business_id"], conversation_id=state.get("customer_id"),
     summary="customer_support → manager (draft returned)")
```

- [ ] **Step 5: Emit escalation in queue_for_human / finalize**

In the terminal escalate path (manager_terminal.py `queue_for_human` node), after saving the action:

```python
emit(agent_id="manager", kind="handoff",
     business_id=state["business_id"], conversation_id=state.get("customer_id"),
     task_id=state.get("action_id"),
     status="escalate",
     summary="escalated to human inbox",
     reasoning=state.get("escalation_summary"))
```

- [ ] **Step 6: Run test, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_manager_traced.py -v"
```

Expected: PASS.

- [ ] **Step 7: Run full manager test suite**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/ -v -k manager"
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add agents/app/agents/manager.py agents/app/agents/manager_evaluator.py agents/app/agents/manager_rewrite.py agents/app/agents/manager_terminal.py agents/tests/test_manager_traced.py
git commit -m "feat(events): trace manager graph + emit handoffs/escalations"
```

---

## Phase 5 — API surface

### Task 9: `/agent/registry` endpoint

**Files:**
- Create: `agents/app/routers/events.py`
- Modify: `agents/app/main.py`
- Test: `agents/tests/test_events_api.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_events_api.py`:

```python
from fastapi.testclient import TestClient
from app.main import app


def test_registry_returns_seeded_agents(seeded_business):
    client = TestClient(app)
    r = client.get("/agent/registry", params={"business_id": seeded_business.id})
    assert r.status_code == 200
    data = r.json()
    ids = {a["id"] for a in data}
    assert {"customer_support", "manager"}.issubset(ids)
    sales = next(a for a in data if a["id"] == "customer_support")
    assert sales["name"] == "Sales Assistant"
    assert "status" in sales  # 'idle' | 'working' | 'error'
```

For auth-scoping in tests: accept `business_id` as a query param fallback when no session cookie is present (dev-only). Document as "dev convenience; in prod session cookie wins".

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_api.py::test_registry_returns_seeded_agents -v"
```

Expected: 404.

- [ ] **Step 3: Implement router + registry endpoint**

Create `agents/app/routers/events.py`:

```python
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, func

from app.db import SessionLocal, Agent, BusinessAgent, AgentEvent

router = APIRouter(prefix="/agent", tags=["events"])


def _derive_status(last_kind: str | None, last_ts: datetime | None, last_status: str | None) -> str:
    if last_ts is None:
        return "idle"
    age = (datetime.now(timezone.utc) - last_ts).total_seconds()
    if last_kind == "error" or last_status == "error":
        return "error"
    if age < 60:
        return "working"
    return "idle"


@router.get("/registry")
def registry(business_id: str = Query(...)):
    with SessionLocal() as s:
        rows = (
            s.query(Agent, BusinessAgent.enabled)
            .join(BusinessAgent, BusinessAgent.agent_id == Agent.id)
            .filter(BusinessAgent.business_id == business_id)
            .all()
        )
        out = []
        for agent, enabled in rows:
            last = (
                s.query(AgentEvent)
                .filter(AgentEvent.agent_id == agent.id,
                        AgentEvent.business_id == business_id)
                .order_by(AgentEvent.id.desc())
                .first()
            )
            stats_24h = s.execute(
                select(func.count(AgentEvent.id))
                .where(AgentEvent.agent_id == agent.id,
                       AgentEvent.business_id == business_id,
                       AgentEvent.ts >= datetime.now(timezone.utc) - timedelta(days=1))
            ).scalar_one()
            out.append({
                "id": agent.id,
                "name": agent.name,
                "role": agent.role,
                "icon": agent.icon,
                "enabled": enabled,
                "status": _derive_status(last.kind if last else None,
                                         last.ts if last else None,
                                         last.status if last else None),
                "current_task": (last.summary if last else None),
                "stats_24h": {"events": stats_24h},
            })
        return out
```

In `agents/app/main.py`, include:

```python
from app.routers.events import router as events_router
app.include_router(events_router)
```

- [ ] **Step 4: Run test, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_api.py::test_registry_returns_seeded_agents -v"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/events.py agents/app/main.py agents/tests/test_events_api.py
git commit -m "feat(api): GET /agent/registry with derived status + 24h stats"
```

---

### Task 10: `/agent/events` history with keyset pagination

**Files:**
- Modify: `agents/app/routers/events.py`
- Modify: `agents/tests/test_events_api.py`

- [ ] **Step 1: Add failing test**

Append to `test_events_api.py`:

```python
from app.db import SessionLocal, AgentEvent

def test_events_list_keyset_pagination(seeded_business):
    client = TestClient(app)
    # seed 5 events
    with SessionLocal() as s:
        for i in range(5):
            s.add(AgentEvent(agent_id="manager", business_id=seeded_business.id,
                             conversation_id="c-page", kind="node.end",
                             summary=f"e{i}"))
        s.commit()

    r = client.get("/agent/events", params={
        "business_id": seeded_business.id, "conversation_id": "c-page", "limit": 2
    })
    assert r.status_code == 200
    page1 = r.json()
    assert len(page1["items"]) == 2
    assert page1["next_cursor"] is not None

    r2 = client.get("/agent/events", params={
        "business_id": seeded_business.id, "conversation_id": "c-page",
        "limit": 2, "before": page1["next_cursor"]
    })
    page2 = r2.json()
    assert len(page2["items"]) == 2
    assert page1["items"][0]["id"] > page2["items"][0]["id"]

    # cleanup
    with SessionLocal() as s:
        s.query(AgentEvent).filter_by(conversation_id="c-page").delete()
        s.commit()


def test_events_filter_by_agent_and_kind(seeded_business):
    client = TestClient(app)
    with SessionLocal() as s:
        s.add(AgentEvent(agent_id="manager", business_id=seeded_business.id,
                         kind="handoff", summary="h1"))
        s.add(AgentEvent(agent_id="customer_support", business_id=seeded_business.id,
                         kind="node.end", summary="n1"))
        s.commit()
    r = client.get("/agent/events", params={
        "business_id": seeded_business.id, "agent_id": "manager", "kind": "handoff"
    })
    items = r.json()["items"]
    assert all(i["agent_id"] == "manager" and i["kind"] == "handoff" for i in items)
```

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_api.py -v"
```

Expected: new tests fail with 404.

- [ ] **Step 3: Implement endpoint**

Append to `agents/app/routers/events.py`:

```python
@router.get("/events")
def events_list(
    business_id: str = Query(...),
    agent_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
    kind: Optional[str] = None,
    before: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
):
    with SessionLocal() as s:
        q = s.query(AgentEvent).filter(AgentEvent.business_id == business_id)
        if agent_id:
            q = q.filter(AgentEvent.agent_id == agent_id)
        if conversation_id:
            q = q.filter(AgentEvent.conversation_id == conversation_id)
        if kind:
            q = q.filter(AgentEvent.kind == kind)
        if before is not None:
            q = q.filter(AgentEvent.id < before)
        q = q.order_by(AgentEvent.id.desc()).limit(limit)
        rows = q.all()
        items = [
            {
                "id": r.id, "ts": r.ts.isoformat() if r.ts else None,
                "agent_id": r.agent_id, "business_id": r.business_id,
                "conversation_id": r.conversation_id, "task_id": r.task_id,
                "kind": r.kind, "node": r.node, "status": r.status,
                "summary": r.summary, "reasoning": r.reasoning,
                "duration_ms": r.duration_ms,
                "tokens_in": r.tokens_in, "tokens_out": r.tokens_out,
            } for r in rows
        ]
        next_cursor = rows[-1].id if len(rows) == limit else None
        return {"items": items, "next_cursor": next_cursor}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_api.py -v"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/events.py agents/tests/test_events_api.py
git commit -m "feat(api): GET /agent/events with keyset pagination + filters"
```

---

### Task 11: `/agent/events/{id}` with trace gating

**Files:**
- Modify: `agents/app/routers/events.py`
- Modify: `agents/tests/test_events_api.py`

- [ ] **Step 1: Add failing test**

Append to `test_events_api.py`:

```python
import os
from unittest.mock import patch

def test_event_detail_hides_trace_by_default(seeded_business):
    client = TestClient(app)
    with SessionLocal() as s:
        e = AgentEvent(agent_id="manager", business_id=seeded_business.id,
                       kind="node.end", summary="x", trace={"prompt": "secret"})
        s.add(e); s.commit(); eid = e.id
    r = client.get(f"/agent/events/{eid}", params={"business_id": seeded_business.id})
    assert r.status_code == 200
    assert r.json().get("trace") is None

def test_event_detail_shows_trace_when_enabled(seeded_business):
    client = TestClient(app)
    with SessionLocal() as s:
        e = AgentEvent(agent_id="manager", business_id=seeded_business.id,
                       kind="node.end", summary="x", trace={"prompt": "visible"})
        s.add(e); s.commit(); eid = e.id
    with patch.dict(os.environ, {"TRACE_LLM": "1"}):
        # force re-read inside endpoint
        r = client.get(f"/agent/events/{eid}",
                       params={"business_id": seeded_business.id},
                       headers={"X-Admin": "1"})
    assert r.json()["trace"]["prompt"] == "visible"
```

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_api.py -v"
```

Expected: 404 on new tests.

- [ ] **Step 3: Implement endpoint**

Append to `agents/app/routers/events.py`:

```python
import os
from fastapi import Header

@router.get("/events/{event_id}")
def event_detail(
    event_id: int,
    business_id: str = Query(...),
    x_admin: Optional[str] = Header(default=None, alias="X-Admin"),
):
    with SessionLocal() as s:
        r = s.query(AgentEvent).filter(
            AgentEvent.id == event_id, AgentEvent.business_id == business_id
        ).first()
        if not r:
            raise HTTPException(status_code=404, detail="event not found")
        include_trace = os.getenv("TRACE_LLM", "0") == "1" and x_admin == "1"
        return {
            "id": r.id, "ts": r.ts.isoformat() if r.ts else None,
            "agent_id": r.agent_id, "business_id": r.business_id,
            "conversation_id": r.conversation_id, "task_id": r.task_id,
            "kind": r.kind, "node": r.node, "status": r.status,
            "summary": r.summary, "reasoning": r.reasoning,
            "trace": r.trace if include_trace else None,
            "duration_ms": r.duration_ms,
            "tokens_in": r.tokens_in, "tokens_out": r.tokens_out,
        }
```

(Admin-role check via `X-Admin` header is a placeholder; integrate with Better Auth in a follow-up if session plumbing exists in API layer.)

- [ ] **Step 4: Run tests, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_events_api.py -v"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/events.py agents/tests/test_events_api.py
git commit -m "feat(api): GET /agent/events/{id} with trace gating"
```

---

### Task 12: `/agent/events/stream` SSE endpoint

**Files:**
- Modify: `agents/app/routers/events.py`
- Test: `agents/tests/test_sse_stream.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_sse_stream.py`:

```python
import json
import threading
import time
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import events as events_module


def test_sse_streams_published_frame():
    client = TestClient(app)
    # publish asynchronously after connection
    def publish_later():
        time.sleep(0.3)
        events_module.emit(agent_id="manager", kind="node.end",
                           business_id="dev-biz", conversation_id="c-sse",
                           summary="ok")
    threading.Thread(target=publish_later, daemon=True).start()

    with client.stream("GET", "/agent/events/stream",
                       params={"business_id": "dev-biz"}) as r:
        start = time.time()
        for line in r.iter_lines():
            if line.startswith("data: "):
                payload = json.loads(line[6:])
                if payload.get("conversation_id") == "c-sse":
                    assert payload["agent_id"] == "manager"
                    return
            if time.time() - start > 5:
                pytest.fail("no SSE frame received")
```

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_sse_stream.py -v"
```

Expected: 404.

- [ ] **Step 3: Implement SSE endpoint**

Append to `agents/app/routers/events.py`:

```python
import asyncio
import json as _json
from fastapi import Request
from fastapi.responses import StreamingResponse
from redis.asyncio import from_url as redis_from_url

@router.get("/events/stream")
async def events_stream(
    request: Request,
    business_id: str = Query(...),
    agent_id: Optional[str] = None,
):
    redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")

    async def gen():
        client = redis_from_url(redis_url)
        pubsub = client.pubsub()
        await pubsub.subscribe("agent.events")
        last_ping = asyncio.get_event_loop().time()
        try:
            while True:
                if await request.is_disconnected():
                    return
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                now = asyncio.get_event_loop().time()
                if msg and msg.get("type") == "message":
                    try:
                        payload = _json.loads(msg["data"])
                    except Exception:
                        continue
                    if payload.get("business_id") != business_id:
                        continue
                    if agent_id and payload.get("agent_id") != agent_id:
                        continue
                    yield f"event: agent.event\ndata: {msg['data'].decode() if isinstance(msg['data'], bytes) else msg['data']}\n\n"
                if now - last_ping >= 15:
                    yield ":ping\n\n"
                    last_ping = now
        finally:
            await pubsub.unsubscribe("agent.events")
            await pubsub.close()
            await client.close()

    return StreamingResponse(gen(), media_type="text/event-stream")
```

- [ ] **Step 4: Run test, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_sse_stream.py -v"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/events.py agents/tests/test_sse_stream.py
git commit -m "feat(api): GET /agent/events/stream SSE with Redis pub/sub"
```

---

### Task 13: `/agent/kpis` endpoint

**Files:**
- Modify: `agents/app/routers/events.py`
- Test: `agents/tests/test_kpis.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_kpis.py`:

```python
from fastapi.testclient import TestClient
from app.main import app
from app.db import SessionLocal, AgentEvent


def test_kpis_shape(seeded_business):
    with SessionLocal() as s:
        s.add(AgentEvent(agent_id="manager", business_id=seeded_business.id,
                         conversation_id="c-k1", kind="node.end",
                         tokens_in=10, tokens_out=5))
        s.add(AgentEvent(agent_id="manager", business_id=seeded_business.id,
                         conversation_id="c-k1", kind="handoff",
                         status="escalate"))
        s.commit()
    client = TestClient(app)
    r = client.get("/agent/kpis", params={"business_id": seeded_business.id})
    assert r.status_code == 200
    j = r.json()
    assert set(j.keys()) == {"active_conversations", "pending_approvals",
                             "escalation_rate", "tokens_spent"}
    assert isinstance(j["tokens_spent"], int)
    assert 0.0 <= j["escalation_rate"] <= 1.0
```

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_kpis.py -v"
```

Expected: 404.

- [ ] **Step 3: Implement endpoint**

Append to `agents/app/routers/events.py`:

```python
from app.db import AgentAction, AgentActionStatus

@router.get("/kpis")
def kpis(business_id: str = Query(...), window: str = "24h"):
    hours = 24 if window == "24h" else 24
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    with SessionLocal() as s:
        active = s.execute(
            select(func.count(func.distinct(AgentEvent.conversation_id)))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since,
                   AgentEvent.conversation_id.is_not(None))
        ).scalar_one()

        pending = s.execute(
            select(func.count(AgentAction.id))
            .where(AgentAction.business_id == business_id,
                   AgentAction.status == AgentActionStatus.pending)
        ).scalar_one()

        total = s.execute(
            select(func.count(AgentEvent.id))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since,
                   AgentEvent.kind == "node.end")
        ).scalar_one() or 0
        escalations = s.execute(
            select(func.count(AgentEvent.id))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since,
                   AgentEvent.status == "escalate")
        ).scalar_one() or 0

        tokens = s.execute(
            select(func.coalesce(
                func.sum(func.coalesce(AgentEvent.tokens_in, 0) +
                         func.coalesce(AgentEvent.tokens_out, 0)),
                0
            ))
            .where(AgentEvent.business_id == business_id,
                   AgentEvent.ts >= since)
        ).scalar_one()

        rate = (escalations / total) if total else 0.0
        return {
            "active_conversations": int(active),
            "pending_approvals": int(pending),
            "escalation_rate": round(float(rate), 4),
            "tokens_spent": int(tokens),
        }
```

Adjust import if `AgentActionStatus` attr is different in existing `db.py`. If no pending status enum, count rows where `approved_at IS NULL AND created_at > since`.

- [ ] **Step 4: Run test, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_kpis.py -v"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/app/routers/events.py agents/tests/test_kpis.py
git commit -m "feat(api): GET /agent/kpis with 24h window"
```

---

### Task 14: Nightly prune retention job

**Files:**
- Create: `agents/app/worker/prune.py`
- Modify: Celery beat schedule (find it via `grep -rn celery_app\|beat_schedule agents/app/worker`).
- Test: `agents/tests/test_prune.py`

- [ ] **Step 1: Write failing test**

Create `agents/tests/test_prune.py`:

```python
from datetime import datetime, timedelta, timezone
from app.db import SessionLocal, AgentEvent
from app.worker.prune import prune_agent_events


def test_prune_drops_older_than_30_days():
    with SessionLocal() as s:
        old = AgentEvent(agent_id="x", kind="node.end",
                         ts=datetime.now(timezone.utc) - timedelta(days=45))
        fresh = AgentEvent(agent_id="x", kind="node.end",
                           ts=datetime.now(timezone.utc) - timedelta(days=1))
        s.add_all([old, fresh]); s.commit()
        old_id, fresh_id = old.id, fresh.id

    prune_agent_events(days=30)

    with SessionLocal() as s:
        assert s.get(AgentEvent, old_id) is None
        assert s.get(AgentEvent, fresh_id) is not None
        s.query(AgentEvent).filter_by(id=fresh_id).delete()
        s.commit()
```

- [ ] **Step 2: Run, expect failure**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_prune.py -v"
```

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement prune**

Create `agents/app/worker/prune.py`:

```python
from datetime import datetime, timedelta, timezone
from sqlalchemy import delete

from app.db import SessionLocal, AgentEvent


def prune_agent_events(days: int = 30) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    with SessionLocal() as s:
        result = s.execute(delete(AgentEvent).where(AgentEvent.ts < cutoff))
        s.commit()
        return result.rowcount or 0
```

Register as Celery task — find the existing Celery app file (likely `agents/app/worker/celery_app.py`) and add:

```python
from celery.schedules import crontab
from app.worker.prune import prune_agent_events

@celery_app.task(name="prune_agent_events")
def prune_task():
    return prune_agent_events(days=30)

celery_app.conf.beat_schedule = {
    **(celery_app.conf.beat_schedule or {}),
    "prune-agent-events-daily": {
        "task": "prune_agent_events",
        "schedule": crontab(hour=3, minute=0),
    },
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/test_prune.py -v"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agents/app/worker/prune.py agents/app/worker/ agents/tests/test_prune.py
git commit -m "feat(worker): nightly prune of agent_events >30 days"
```

---

## Phase 6 — Frontend plumbing

### Task 15: Typed API client

**Files:**
- Create: `app/src/lib/agent-api.ts`
- Test: (n/a — type-only module, smoke covered by component tests)

- [ ] **Step 1: Write client**

Create `app/src/lib/agent-api.ts`:

```ts
const BASE = import.meta.env.VITE_AGENTS_BASE_URL ?? "http://localhost:8000";

export type AgentRow = {
  id: string;
  name: string;
  role: string;
  icon: string | null;
  enabled: boolean;
  status: "idle" | "working" | "error";
  current_task: string | null;
  stats_24h: { events: number };
};

export type AgentEvent = {
  id: number;
  ts: string;
  agent_id: string;
  business_id: string | null;
  conversation_id: string | null;
  task_id: string | null;
  kind: "node.start" | "node.end" | "handoff" | "message.in" | "message.out" | "error";
  node: string | null;
  status: "ok" | "error" | "revise" | "escalate" | null;
  summary: string | null;
  reasoning: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  trace?: unknown;
};

export type Kpis = {
  active_conversations: number;
  pending_approvals: number;
  escalation_rate: number;
  tokens_spent: number;
};

async function jget<T>(path: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && qs.set(k, String(v)));
  const r = await fetch(`${BASE}${path}?${qs}`, { credentials: "include" });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return (await r.json()) as T;
}

export const agentApi = {
  registry: (businessId: string) =>
    jget<AgentRow[]>("/agent/registry", { business_id: businessId }),
  events: (p: { businessId: string; agentId?: string; conversationId?: string; kind?: string; before?: number; limit?: number }) =>
    jget<{ items: AgentEvent[]; next_cursor: number | null }>("/agent/events", {
      business_id: p.businessId, agent_id: p.agentId, conversation_id: p.conversationId,
      kind: p.kind, before: p.before, limit: p.limit ?? 50,
    }),
  event: (id: number, businessId: string) =>
    jget<AgentEvent>(`/agent/events/${id}`, { business_id: businessId }),
  kpis: (businessId: string) =>
    jget<Kpis>("/agent/kpis", { business_id: businessId }),
};
```

- [ ] **Step 2: Verify types compile**

```bash
cd app && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/agent-api.ts
git commit -m "feat(app): typed agent-api client"
```

---

### Task 16: SSE stream wrapper with reconnect + fallback

**Files:**
- Create: `app/src/lib/agent-events-stream.ts`
- Create: `app/src/lib/agent-events-store.ts`
- Test: `app/src/__tests__/dashboard/stream-reconnect.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/src/__tests__/dashboard/stream-reconnect.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openAgentEventStream } from "@/lib/agent-events-stream";

class MockES {
  static instances: MockES[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  readyState = 0;
  constructor(public url: string) { MockES.instances.push(this); }
  close() { this.readyState = 2; }
}

beforeEach(() => {
  MockES.instances = [];
  (globalThis as any).EventSource = MockES;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("openAgentEventStream", () => {
  it("falls back to polling after 3 failures", async () => {
    const onFallback = vi.fn();
    const onEvent = vi.fn();
    const handle = openAgentEventStream({
      businessId: "b1", onEvent, onFallback, onConnect: () => {},
    });
    for (let i = 0; i < 3; i++) {
      const es = MockES.instances.at(-1)!;
      es.onerror?.(new Event("error"));
      vi.advanceTimersByTime(60_000);
    }
    expect(onFallback).toHaveBeenCalled();
    handle.close();
  });

  it("delivers parsed frames to onEvent", () => {
    const onEvent = vi.fn();
    openAgentEventStream({
      businessId: "b1", onEvent, onFallback: () => {}, onConnect: () => {},
    });
    const es = MockES.instances.at(-1)!;
    es.onmessage?.(new MessageEvent("message", {
      data: JSON.stringify({ id: 1, agent_id: "manager", kind: "node.end" }),
    }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ agent_id: "manager" }));
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd app && pnpm test stream-reconnect
```

Expected: module not found.

- [ ] **Step 3: Implement stream wrapper**

Create `app/src/lib/agent-events-stream.ts`:

```ts
import type { AgentEvent } from "./agent-api";

type Opts = {
  businessId: string;
  agentId?: string;
  onEvent: (ev: AgentEvent) => void;
  onConnect: () => void;
  onFallback: () => void;
};

const BASE = import.meta.env.VITE_AGENTS_BASE_URL ?? "http://localhost:8000";
const MAX_FAILS = 3;
const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

export function openAgentEventStream(opts: Opts) {
  let fails = 0;
  let closed = false;
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    const qs = new URLSearchParams({ business_id: opts.businessId });
    if (opts.agentId) qs.set("agent_id", opts.agentId);
    es = new EventSource(`${BASE}/agent/events/stream?${qs}`, { withCredentials: true });
    es.onopen = () => { fails = 0; opts.onConnect(); };
    es.onmessage = (e) => {
      try { opts.onEvent(JSON.parse(e.data)); }
      catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      es?.close();
      fails += 1;
      if (fails >= MAX_FAILS) { opts.onFallback(); return; }
      const delay = BACKOFF[Math.min(fails - 1, BACKOFF.length - 1)];
      reconnectTimer = setTimeout(connect, delay);
    };
  }
  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    },
  };
}
```

Create `app/src/lib/agent-events-store.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import type { AgentEvent } from "./agent-api";

const MAX_BUFFER = 200;

type Filters = { businessId: string; agentId?: string; conversationId?: string; kind?: string };

export function prependEvent(qc: QueryClient, filters: Filters, ev: AgentEvent) {
  // match if event passes all active filters
  if (filters.agentId && ev.agent_id !== filters.agentId) return;
  if (filters.conversationId && ev.conversation_id !== filters.conversationId) return;
  if (filters.kind && ev.kind !== filters.kind) return;

  qc.setQueryData<{ pages: { items: AgentEvent[]; next_cursor: number | null }[] }>(
    ["events", filters],
    (old) => {
      if (!old) return { pages: [{ items: [ev], next_cursor: null }] };
      const first = old.pages[0];
      const merged = [ev, ...first.items].slice(0, MAX_BUFFER);
      return { ...old, pages: [{ ...first, items: merged }, ...old.pages.slice(1)] };
    }
  );
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
cd app && pnpm test stream-reconnect
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/agent-events-stream.ts app/src/lib/agent-events-store.ts app/src/__tests__/dashboard/stream-reconnect.test.ts
git commit -m "feat(app): SSE stream wrapper with reconnect + fallback"
```

---

## Phase 7 — UI components

### Task 17: AgentCard component

**Files:**
- Create: `app/src/components/dashboard/AgentCard.tsx`
- Test: `app/src/__tests__/dashboard/AgentCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `app/src/__tests__/dashboard/AgentCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { AgentCard } from "@/components/dashboard/AgentCard";

const base = {
  id: "manager", name: "Manager", role: "Reviews replies",
  icon: "brain", enabled: true, current_task: null,
  stats_24h: { events: 0 },
} as const;

test("renders working status with green pill", () => {
  render(<AgentCard agent={{ ...base, status: "working", current_task: "reviewing c_42" }} />);
  expect(screen.getByText(/reviewing c_42/i)).toBeInTheDocument();
  expect(screen.getByTestId("status-pill")).toHaveClass("bg-emerald-500");
});

test("renders idle status", () => {
  render(<AgentCard agent={{ ...base, status: "idle" }} />);
  expect(screen.getByTestId("status-pill")).toHaveClass("bg-zinc-500");
});

test("renders error status", () => {
  render(<AgentCard agent={{ ...base, status: "error" }} />);
  expect(screen.getByTestId("status-pill")).toHaveClass("bg-red-500");
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd app && pnpm test AgentCard
```

Expected: module not found.

- [ ] **Step 3: Implement component**

Create `app/src/components/dashboard/AgentCard.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { AgentRow } from "@/lib/agent-api";

const STATUS_STYLES: Record<AgentRow["status"], string> = {
  working: "bg-emerald-500",
  idle: "bg-zinc-500",
  error: "bg-red-500",
};

export function AgentCard({ agent, onClick }: { agent: AgentRow; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-left hover:border-zinc-700 transition"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{agent.icon ?? "🤖"}</span>
          <span className="font-medium text-zinc-100">{agent.name}</span>
        </div>
        <span
          data-testid="status-pill"
          className={cn("h-2 w-2 rounded-full", STATUS_STYLES[agent.status])}
        />
      </div>
      <div className="mt-2 text-xs text-zinc-400">{agent.role}</div>
      <div className="mt-3 text-sm text-zinc-200 line-clamp-1">
        {agent.current_task ?? <span className="text-zinc-500">idle</span>}
      </div>
      <div className="mt-2 text-[11px] text-zinc-500">
        {agent.stats_24h.events} events · 24h
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
cd app && pnpm test AgentCard
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/dashboard/AgentCard.tsx app/src/__tests__/dashboard/AgentCard.test.tsx
git commit -m "feat(app): AgentCard component with status pill"
```

---

### Task 18: AgentRoster component

**Files:**
- Create: `app/src/components/dashboard/AgentRoster.tsx`

- [ ] **Step 1: Implement (behavior covered by dashboard integration test later)**

```tsx
import { useQuery } from "@tanstack/react-query";
import { agentApi } from "@/lib/agent-api";
import { AgentCard } from "./AgentCard";
import { useNavigate } from "@tanstack/react-router";

export function AgentRoster({ businessId }: { businessId: string }) {
  const nav = useNavigate();
  const { data = [], isLoading } = useQuery({
    queryKey: ["registry", businessId],
    queryFn: () => agentApi.registry(businessId),
    refetchInterval: 15_000,
  });

  if (isLoading) return <div className="text-sm text-zinc-500">Loading agents…</div>;

  return (
    <section>
      <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Agents</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            onClick={() => nav({ to: "/agents/$agentId", params: { agentId: a.id } })}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: tsc check**

```bash
cd app && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/dashboard/AgentRoster.tsx
git commit -m "feat(app): AgentRoster grid with registry query"
```

---

### Task 19: KpiTiles component

**Files:**
- Create: `app/src/components/dashboard/KpiTiles.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useQuery } from "@tanstack/react-query";
import { agentApi } from "@/lib/agent-api";

const fmt = new Intl.NumberFormat();

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="text-2xl font-semibold text-zinc-100">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

export function KpiTiles({ businessId }: { businessId: string }) {
  const { data } = useQuery({
    queryKey: ["kpis", businessId],
    queryFn: () => agentApi.kpis(businessId),
    refetchInterval: 30_000,
  });
  return (
    <section>
      <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Dashboards</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Active Conversations" value={fmt.format(data?.active_conversations ?? 0)} />
        <Tile label="Pending Approvals" value={fmt.format(data?.pending_approvals ?? 0)} />
        <Tile label="Escalation Rate 24h" value={`${((data?.escalation_rate ?? 0) * 100).toFixed(1)}%`} />
        <Tile label="Tokens Spent 24h" value={fmt.format(data?.tokens_spent ?? 0)} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/components/dashboard/KpiTiles.tsx
git commit -m "feat(app): KpiTiles with 4 metric tiles"
```

---

### Task 20: ActivityFeed component

**Files:**
- Create: `app/src/components/dashboard/ActivityFeed.tsx`
- Test: `app/src/__tests__/dashboard/ActivityFeed.test.tsx`

- [ ] **Step 1: Install react-virtuoso if missing**

```bash
cd app && pnpm add react-virtuoso
```

- [ ] **Step 2: Write failing test**

Create `app/src/__tests__/dashboard/ActivityFeed.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { prependEvent } from "@/lib/agent-events-store";

test("renders event from query cache; merges SSE frame", () => {
  const qc = new QueryClient();
  const filters = { businessId: "b1" };
  qc.setQueryData(["events", filters], {
    pages: [{ items: [{ id: 1, ts: "2026-04-25T00:00:00Z", agent_id: "manager",
                        kind: "node.end", summary: "first" }], next_cursor: null }],
  });
  render(
    <QueryClientProvider client={qc}>
      <ActivityFeed filters={filters} />
    </QueryClientProvider>
  );
  expect(screen.getByText("first")).toBeInTheDocument();

  prependEvent(qc, filters, {
    id: 2, ts: "2026-04-25T00:00:05Z", agent_id: "manager",
    kind: "node.end", summary: "second",
  } as any);
  expect(screen.getByText("second")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run, expect failure**

```bash
cd app && pnpm test ActivityFeed
```

Expected: module not found.

- [ ] **Step 4: Implement**

Create `app/src/components/dashboard/ActivityFeed.tsx`:

```tsx
import { useInfiniteQuery } from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import { agentApi, type AgentEvent } from "@/lib/agent-api";
import { cn } from "@/lib/utils";

type Filters = { businessId: string; agentId?: string; conversationId?: string; kind?: string };

const KIND_COLOR: Record<AgentEvent["kind"], string> = {
  "node.start": "bg-zinc-500",
  "node.end": "bg-emerald-500",
  "handoff": "bg-violet-500",
  "message.in": "bg-sky-500",
  "message.out": "bg-cyan-500",
  "error": "bg-red-500",
};

export function ActivityFeed({ filters, onRowClick }: {
  filters: Filters;
  onRowClick?: (e: AgentEvent) => void;
}) {
  const q = useInfiniteQuery({
    queryKey: ["events", filters],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      agentApi.events({ ...filters, before: pageParam, limit: 50 }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section>
      <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Recent Activity</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900">
        <Virtuoso
          style={{ height: 420 }}
          data={items}
          endReached={() => q.hasNextPage && q.fetchNextPage()}
          itemContent={(_, ev) => (
            <button
              onClick={() => onRowClick?.(ev)}
              className="flex w-full items-center gap-3 border-b border-zinc-800 px-4 py-2 text-left hover:bg-zinc-800/50"
            >
              <span className={cn("h-2 w-2 rounded-full", KIND_COLOR[ev.kind])} />
              <span className="w-28 shrink-0 text-xs text-zinc-500">{ev.agent_id}</span>
              <span className="flex-1 truncate text-sm text-zinc-200">
                {ev.summary ?? `${ev.kind} ${ev.node ?? ""}`}
              </span>
              <span className="text-[11px] text-zinc-500">
                {new Date(ev.ts).toLocaleTimeString()}
              </span>
            </button>
          )}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test, expect pass**

```bash
cd app && pnpm test ActivityFeed
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/dashboard/ActivityFeed.tsx app/src/__tests__/dashboard/ActivityFeed.test.tsx app/package.json app/pnpm-lock.yaml
git commit -m "feat(app): ActivityFeed virtualized event list"
```

---

### Task 21: TaskList component (reuse inbox)

**Files:**
- Create: `app/src/components/dashboard/TaskList.tsx`

- [ ] **Step 1: Locate existing inbox actions hook**

```bash
grep -rn "inbox\|actions" app/src/components app/src/routes | head
```

Note the existing hook/fetcher (likely in `app/src/routes/$businessCode/inbox.tsx` or similar).

- [ ] **Step 2: Implement**

Create `app/src/components/dashboard/TaskList.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
// Adjust import to match existing inbox data hook. If none exists yet,
// call the inbox fetcher directly:
async function fetchInboxActions(businessId: string) {
  const r = await fetch(
    `${import.meta.env.VITE_AGENTS_BASE_URL ?? "http://localhost:8000"}/agent/actions?business_id=${businessId}`,
    { credentials: "include" }
  );
  if (!r.ok) throw new Error("actions " + r.status);
  return (await r.json()) as { id: string; status: string; preview: string; createdAt: string }[];
}

const CHIP = {
  pending: "bg-amber-500/20 text-amber-300",
  approved: "bg-emerald-500/20 text-emerald-300",
  escalated: "bg-red-500/20 text-red-300",
  sent: "bg-sky-500/20 text-sky-300",
} as const;

export function TaskList({ businessId }: { businessId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["inbox-actions", businessId],
    queryFn: () => fetchInboxActions(businessId),
    refetchInterval: 10_000,
  });

  return (
    <section>
      <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Recent Tasks</h2>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900">
        {data.slice(0, 20).map((t) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2 last:border-0">
            <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${CHIP[t.status as keyof typeof CHIP] ?? "bg-zinc-500/20 text-zinc-300"}`}>
              {t.status}
            </span>
            <span className="flex-1 truncate text-sm text-zinc-200">{t.preview}</span>
            <span className="text-[11px] text-zinc-500">
              {new Date(t.createdAt).toLocaleTimeString()}
            </span>
          </div>
        ))}
        {data.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">No tasks yet</div>
        )}
      </div>
    </section>
  );
}
```

If the existing inbox route already has a typed hook (e.g. `useInboxActions`), import and use that instead; delete the local `fetchInboxActions`.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/dashboard/TaskList.tsx
git commit -m "feat(app): TaskList reusing inbox actions"
```

---

### Task 22: EventDrawer component

**Files:**
- Create: `app/src/components/dashboard/EventDrawer.tsx`
- Test: `app/src/__tests__/dashboard/EventDrawer.test.tsx`

- [ ] **Step 1: Write failing test**

Create `app/src/__tests__/dashboard/EventDrawer.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EventDrawer } from "@/components/dashboard/EventDrawer";
import { vi } from "vitest";

vi.mock("@/lib/agent-api", () => ({
  agentApi: {
    event: vi.fn().mockResolvedValue({
      id: 1, ts: "2026-04-25T00:00:00Z", agent_id: "manager",
      business_id: "b1", conversation_id: "c1", kind: "node.end",
      node: "evaluate", status: "revise", summary: "needs tone fix",
      reasoning: "too blunt", duration_ms: 123,
      tokens_in: 5, tokens_out: 8,
    }),
    events: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
  },
}));

test("shows reasoning and hides trace tab when no trace", async () => {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <EventDrawer eventId={1} businessId="b1" open onClose={() => {}} />
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getByText("too blunt")).toBeInTheDocument());
  expect(screen.queryByRole("tab", { name: /trace/i })).toBeNull();
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd app && pnpm test EventDrawer
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `app/src/components/dashboard/EventDrawer.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agentApi } from "@/lib/agent-api";

export function EventDrawer({
  eventId, businessId, open, onClose,
}: { eventId: number | null; businessId: string; open: boolean; onClose: () => void }) {
  const { data: ev } = useQuery({
    queryKey: ["event-detail", eventId, businessId],
    queryFn: () => (eventId == null ? null : agentApi.event(eventId, businessId)),
    enabled: !!eventId,
  });
  const { data: siblings } = useQuery({
    queryKey: ["event-siblings", ev?.conversation_id, businessId],
    queryFn: () => agentApi.events({ businessId, conversationId: ev!.conversation_id!, limit: 50 }),
    enabled: !!ev?.conversation_id,
  });

  const hasTrace = !!ev && "trace" in ev && ev.trace !== null && ev.trace !== undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {ev ? `${ev.agent_id} · ${ev.node ?? ev.kind}` : "Loading…"}
          </SheetTitle>
        </SheetHeader>
        {ev && (
          <Tabs defaultValue="timeline" className="mt-4">
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="reasoning">Reasoning</TabsTrigger>
              {hasTrace && <TabsTrigger value="trace">Trace</TabsTrigger>}
            </TabsList>
            <TabsContent value="timeline">
              <ol className="space-y-1 text-sm">
                {(siblings?.items ?? []).map((s) => (
                  <li key={s.id} className={s.id === ev.id ? "text-emerald-400" : "text-zinc-300"}>
                    <span className="text-zinc-500">{new Date(s.ts).toLocaleTimeString()} · </span>
                    {s.kind} {s.node ?? ""} — {s.summary ?? ""}
                  </li>
                ))}
              </ol>
            </TabsContent>
            <TabsContent value="reasoning">
              <pre className="whitespace-pre-wrap text-sm text-zinc-200">
                {ev.reasoning ?? ev.summary ?? "(none)"}
              </pre>
            </TabsContent>
            {hasTrace && (
              <TabsContent value="trace">
                <pre className="overflow-x-auto text-xs text-zinc-300">
                  {JSON.stringify(ev.trace, null, 2)}
                </pre>
              </TabsContent>
            )}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

If `@/components/ui/sheet` / `@/components/ui/tabs` not scaffolded, run `pnpm dlx shadcn@latest add sheet tabs` from `app/`.

- [ ] **Step 4: Run test, expect pass**

```bash
cd app && pnpm test EventDrawer
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/dashboard/EventDrawer.tsx app/src/__tests__/dashboard/EventDrawer.test.tsx
git commit -m "feat(app): EventDrawer with timeline/reasoning/trace tabs"
```

---

### Task 23: ConnectionBanner component

**Files:**
- Create: `app/src/components/dashboard/ConnectionBanner.tsx`

- [ ] **Step 1: Implement**

```tsx
export function ConnectionBanner({ fallback }: { fallback: boolean }) {
  if (!fallback) return null;
  return (
    <div className="border-b border-amber-800 bg-amber-950/60 px-4 py-2 text-xs text-amber-200">
      Live updates paused. Refreshing every 5s.
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/components/dashboard/ConnectionBanner.tsx
git commit -m "feat(app): ConnectionBanner for SSE fallback mode"
```

---

## Phase 8 — Dashboard route + deep-links

### Task 24: /dashboard route wiring it all together

**Files:**
- Create: `app/src/routes/dashboard.tsx`

- [ ] **Step 1: Implement**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AgentRoster } from "@/components/dashboard/AgentRoster";
import { KpiTiles } from "@/components/dashboard/KpiTiles";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { TaskList } from "@/components/dashboard/TaskList";
import { EventDrawer } from "@/components/dashboard/EventDrawer";
import { ConnectionBanner } from "@/components/dashboard/ConnectionBanner";
import { openAgentEventStream } from "@/lib/agent-events-stream";
import { prependEvent } from "@/lib/agent-events-store";
import type { AgentEvent } from "@/lib/agent-api";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  // TODO: pull businessId from session/loader when Better Auth context is wired;
  // for dev the seed business is 'dev-biz'.
  const businessId = "dev-biz";
  const qc = useQueryClient();
  const [fallback, setFallback] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);

  useEffect(() => {
    const h = openAgentEventStream({
      businessId,
      onConnect: () => setFallback(false),
      onFallback: () => {
        setFallback(true);
        const t = setInterval(() => {
          qc.invalidateQueries({ queryKey: ["events"] });
          qc.invalidateQueries({ queryKey: ["registry", businessId] });
          qc.invalidateQueries({ queryKey: ["kpis", businessId] });
        }, 5000);
        (h as any).pollTimer = t;
      },
      onEvent: (ev: AgentEvent) => {
        prependEvent(qc, { businessId }, ev);
        qc.invalidateQueries({ queryKey: ["kpis", businessId] });
        qc.invalidateQueries({ queryKey: ["registry", businessId] });
      },
    });
    return () => {
      h.close();
      if ((h as any).pollTimer) clearInterval((h as any).pollTimer);
    };
  }, [businessId, qc]);

  return (
    <div className="min-h-screen bg-black text-zinc-200">
      <ConnectionBanner fallback={fallback} />
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <AgentRoster businessId={businessId} />
        <KpiTiles businessId={businessId} />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ActivityFeed filters={{ businessId }} onRowClick={(e) => setDrawerId(e.id)} />
          <TaskList businessId={businessId} />
        </div>
      </div>
      <EventDrawer
        eventId={drawerId}
        businessId={businessId}
        open={drawerId != null}
        onClose={() => setDrawerId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Regenerate route tree**

```bash
cd app && pnpm dev --tsc=off
# or just save to trigger the plugin; verify app/src/routeTree.gen.ts now exports /dashboard
```

Kill the dev server once the route appears.

- [ ] **Step 3: Manual smoke**

Start stack + app. Open `http://localhost:3000/dashboard`. Send a chat message via the seed smoke curl. Verify:
- Agent card flips to `working` then `idle`.
- Activity feed shows events appearing live.
- KPI tiles update.
- Click an activity row → drawer opens with reasoning.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/dashboard.tsx app/src/routeTree.gen.ts
git commit -m "feat(app): /dashboard route wires roster, KPIs, feed, tasks, drawer"
```

---

### Task 25: Deep-link routes /agents/$agentId + /events/$eventId

**Files:**
- Create: `app/src/routes/agents.$agentId.tsx`
- Create: `app/src/routes/events.$eventId.tsx`

- [ ] **Step 1: Implement agent page**

```tsx
// app/src/routes/agents.$agentId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { agentApi } from "@/lib/agent-api";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";

export const Route = createFileRoute("/agents/$agentId")({
  component: AgentDetail,
});

function AgentDetail() {
  const { agentId } = Route.useParams();
  const businessId = "dev-biz";
  const { data } = useQuery({
    queryKey: ["registry", businessId],
    queryFn: () => agentApi.registry(businessId),
  });
  const meta = data?.find((a) => a.id === agentId);
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">{meta?.icon ?? "🤖"}</span>
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{meta?.name ?? agentId}</h1>
          <p className="text-sm text-zinc-400">{meta?.role}</p>
        </div>
      </header>
      <ActivityFeed filters={{ businessId, agentId }} />
    </div>
  );
}
```

- [ ] **Step 2: Implement event detail page**

```tsx
// app/src/routes/events.$eventId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { EventDrawer } from "@/components/dashboard/EventDrawer";

export const Route = createFileRoute("/events/$eventId")({
  component: EventDetail,
});

function EventDetail() {
  const { eventId } = Route.useParams();
  return (
    <EventDrawer
      eventId={Number(eventId)}
      businessId="dev-biz"
      open
      onClose={() => history.back()}
    />
  );
}
```

- [ ] **Step 3: Manual smoke**

Navigate to `/agents/manager`. Verify activity feed filtered to manager events. Navigate to `/events/1` — drawer opens full-page.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/agents.$agentId.tsx app/src/routes/events.$eventId.tsx app/src/routeTree.gen.ts
git commit -m "feat(app): deep-link routes for agent + event detail"
```

---

## Phase 9 — E2E verification

### Task 26: E2E smoke — full manager revise→pass path populates events

**Files:**
- Modify: existing manager E2E test (`agents/tests/test_manager_graph_smoke.py` or similar).

- [ ] **Step 1: Append assertion to existing smoke**

At end of existing manager revise→pass smoke test:

```python
from app.db import AgentEvent

with SessionLocal() as s:
    evs = s.query(AgentEvent).filter_by(
        conversation_id=CONV_ID
    ).order_by(AgentEvent.id).all()

kinds = [(e.agent_id, e.kind, e.node) for e in evs]
agents_seen = {a for a, *_ in kinds}
assert {"manager", "customer_support"}.issubset(agents_seen)
assert any(k == "handoff" for _, k, _ in kinds)
# evaluator node must fire at least once with revise status
assert any(e.node == "evaluate" and e.status == "revise" for e in evs)
```

- [ ] **Step 2: Run suite**

```bash
./scripts/dev.sh shell -c "pytest agents/tests/ -v"
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add agents/tests/
git commit -m "test(e2e): verify agent_events populated across manager revise→pass"
```

---

### Task 27: Manual verification checklist

- [ ] **Step 1: Live updates work end-to-end**

1. `./scripts/dev.sh down && ./scripts/dev.sh up`
2. `cd app && pnpm dev`
3. Open `http://localhost:3000/dashboard`
4. In another terminal:
   ```bash
   curl -s -X POST http://localhost:8000/agent/support/chat \
     -H 'Content-Type: application/json' \
     -d '{"business_id":"dev-biz","customer_id":"c-live","customer_phone":"+60123456789","message":"nak beli 2 pisang hijau"}' | jq
   ```
5. Observe:
   - AgentCard for customer_support flips `working` green, settles back to `idle`.
   - Activity feed adds rows in real time.
   - KPI `Active Conversations` increments.
   - Click a row → drawer shows reasoning.

- [ ] **Step 2: Fallback works**

1. In `docker-compose.yml`-style shell: `docker compose stop redis`
2. Dashboard shows amber banner within ~12s ("Live updates paused").
3. Continue to send chats — they still appear within 5s via polling.
4. `docker compose start redis` → banner clears on next reconnect.

- [ ] **Step 3: Commit (no-op, documentation)**

If any drift from plan observed, file issues. Otherwise nothing to commit.

---

## Self-Review

Ran through spec against plan:

- **Architecture diagram** (spec §Architecture): Tasks 1, 4, 12, 16 build all four legs (Redis infra, emit dual-write, SSE, client).
- **Data model** (spec §Data model): Tasks 2, 3.
- **Agent registry** (spec §Agent registry): Task 6.
- **Event payload depth** (spec §Event payload depth): Task 4 captures all fields; Task 11 gates `trace`.
- **Event emission** (spec §Event emission): Tasks 4, 5, 7, 8.
- **Infra** (spec §Infra): Task 1.
- **API surface** (spec §API surface): Tasks 9, 10, 11, 12, 13.
- **Frontend** (spec §Frontend): Tasks 15–25.
- **Error handling** (spec §Error handling): Task 4 swallows; Task 16 reconnect + fallback; Task 23 banner.
- **Security** (spec §Security): `business_id` filter on every endpoint (Tasks 9–13); `trace` gating (Task 11). SSE concurrent-stream limit NOT yet implemented — accepted as follow-up, `TODO` below.
- **Testing** (spec §Testing): every backend test enumerated in spec maps to Tasks 4, 5, 6, 9–13, 14, 26. Frontend tests in Tasks 17, 20, 22, 16.

Open follow-ups (not blocking v1):
- SSE rate-limit per session (design §Security bullet 3).
- Replace `X-Admin` header placeholder with Better Auth role check.
- Pull `businessId` from session instead of hardcoding `"dev-biz"` in dashboard route.

Placeholder scan: no TBD/TODO in step bodies except acknowledged follow-ups above.

Type consistency: `AgentEvent` shape matches between `agent-api.ts`, SSE wrapper, drawer tests, backend response in Tasks 10/11. Registry response shape `AgentRow` matches Task 9 return.
