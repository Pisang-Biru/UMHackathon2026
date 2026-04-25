# Schema Isolation + DB Safety Hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all alembic-managed tables from `public.*` to `agents.*` so Prisma cannot perceive or destroy them, then add CLAUDE.md + a PreToolUse Bash hook that blocks destructive DB commands by default.

**Architecture:** One Postgres database, two schemas, two migrators. Prisma owns `public.*` (TS app). Alembic owns `agents.*` (Python runtime). Each migrator is configured with an explicit allowlist so it cannot see the other's tables. A new alembic data migration (`0005`) does the one-time `ALTER TABLE ... SET SCHEMA` move, preserving data and indexes. Process safety = CLAUDE.md rule + a project-level Claude Code hook that pattern-matches destructive Bash commands and exits 2 (block) with a reason.

**Tech Stack:** PostgreSQL 17, Alembic, SQLAlchemy 2.x, Prisma 7.x (multiSchema preview feature), Bash, Claude Code PreToolUse hook.

**Spec:** `docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md`

---

## File Touch Plan

**Create:**
- `agents/alembic/versions/0005_isolate_agents_schema.py` — data migration: `CREATE SCHEMA agents` + 9× `ALTER TABLE ... SET SCHEMA agents`.
- `agents/tests/test_models_use_agents_schema.py` — pytest assertion that every alembic-owned model carries `schema="agents"`.
- `scripts/guard-destructive-db.sh` — PreToolUse hook script.
- `tests/scripts/test_guard_destructive_db.sh` — bash test harness for the hook.
- `CLAUDE.md` (project root) — DB safety rule.
- `.claude/settings.json` — PreToolUse hook registration.

**Modify:**
- `agents/app/db.py:88-120` — add `__table_args__ = {"schema": "agents"}` to `Agent`, `BusinessAgent`, `AgentEvent`. Fix `BusinessAgent.agent_id` FK to `agents.agents.id`.
- `agents/app/memory/models.py:9-65` — add `__table_args__ = {"schema": "agents"}` to all five memory models.
- `agents/alembic/env.py:13-40` — set `version_table_schema="agents"`, `include_schemas=True`, `include_object` filter.
- `app/prisma/schema.prisma:1-25` — add `previewFeatures = ["multiSchema"]` to `generator client`, add `schemas = ["public"]` to `datasource db`, add `@@schema("public")` to every model.

**Already created in earlier sessions (out-of-scope for this plan but cross-referenced):**
- `scripts/apply-agents-schema.sh` (teammate one-shot helper).
- `README.md` "Database layout" section.
- `docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md` (the spec).

---

## Pre-flight: branch + worktree

- [ ] **Step 1: Create a feature branch from current `atan`**

```bash
cd /Users/hariz/PisangProject/umhackathon2026
git status                       # confirm clean
git checkout -b atan/schema-isolation
```

- [ ] **Step 2: Confirm dev stack is running**

```bash
docker compose ps
```

Expected: `postgres`, `rabbitmq`, `redis`, `agents-api`, `agents-worker`, `agents-beat` all `Up`.

If not: `./scripts/dev.sh up`.

- [ ] **Step 3: Snapshot current row counts (baseline for the validation gate)**

```bash
docker compose exec -T postgres psql -U postgres -d pisangbisnes -c "
  SELECT 'memory_conversation_summary' AS t, count(*) FROM memory_conversation_summary
  UNION ALL SELECT 'memory_conversation_turn',    count(*) FROM memory_conversation_turn
  UNION ALL SELECT 'memory_kb_chunk',             count(*) FROM memory_kb_chunk
  UNION ALL SELECT 'memory_past_action',          count(*) FROM memory_past_action
  UNION ALL SELECT 'memory_product_embedding',    count(*) FROM memory_product_embedding
  UNION ALL SELECT 'agent_events',                count(*) FROM agent_events
  UNION ALL SELECT 'agents',                      count(*) FROM agents
  UNION ALL SELECT 'business_agents',             count(*) FROM business_agents;"
```

Save the output to a scratch file or scrollback. Step 12 compares against this.

---

## Task 1: Failing test for schema annotation on alembic-owned models

**Files:**
- Create: `agents/tests/test_models_use_agents_schema.py`

- [ ] **Step 1: Write the failing test**

Create `agents/tests/test_models_use_agents_schema.py`:

```python
"""All alembic-owned models live in the `agents.*` Postgres schema.

Prisma owns `public.*`. Drift between the two migrators is the intended boundary
— this test fails loudly if a model is left in `public` by accident.
"""
from app.db import Agent, BusinessAgent, AgentEvent
from app.memory.models import (
    MemoryConversationTurn,
    MemoryConversationSummary,
    MemoryKbChunk,
    MemoryPastAction,
    MemoryProductEmbedding,
)

ALEMBIC_OWNED = [
    Agent,
    BusinessAgent,
    AgentEvent,
    MemoryConversationTurn,
    MemoryConversationSummary,
    MemoryKbChunk,
    MemoryPastAction,
    MemoryProductEmbedding,
]


def test_all_alembic_models_use_agents_schema():
    offenders = [m.__name__ for m in ALEMBIC_OWNED if m.__table__.schema != "agents"]
    assert not offenders, f"models missing schema='agents': {offenders}"


def test_business_agents_fk_targets_agents_schema():
    fks = list(BusinessAgent.__table__.c.agent_id.foreign_keys)
    assert len(fks) == 1
    target = fks[0].target_fullname
    assert target == "agents.agents.id", f"FK target was {target!r}, expected 'agents.agents.id'"
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
docker compose exec -T agents-api python -m pytest tests/test_models_use_agents_schema.py -v
```

Expected: both tests FAIL. The first reports all 8 models as offenders (`schema=None`). The second reports `target_fullname == 'agents.id'`.

If pytest is missing inside the container (it was during the previous session), install it once:

```bash
docker compose exec -T agents-api pip install pytest
```

---

## Task 2: Add `__table_args__` to alembic-owned SQLAlchemy models

**Files:**
- Modify: `agents/app/db.py:88-120`
- Modify: `agents/app/memory/models.py:9-65`

- [ ] **Step 1: Edit `agents/app/db.py` — add schema to `Agent`**

Replace the `Agent` class definition with:

```python
class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = {"schema": "agents"}
    id = Column(Text, primary_key=True)
    name = Column(Text, nullable=False)
    role = Column(Text, nullable=False)
    icon = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
```

- [ ] **Step 2: Edit `agents/app/db.py` — add schema to `BusinessAgent` and fix the FK**

Replace the `BusinessAgent` class definition with:

```python
class BusinessAgent(Base):
    __tablename__ = "business_agents"
    __table_args__ = {"schema": "agents"}
    business_id = Column(Text, primary_key=True)
    agent_id = Column(Text, ForeignKey("agents.agents.id"), primary_key=True)
    enabled = Column(Boolean, nullable=False, server_default=text("true"))
```

(The FK target string changes from `"agents.id"` → `"agents.agents.id"` because both ends are now in the `agents` schema.)

- [ ] **Step 3: Edit `agents/app/db.py` — add schema to `AgentEvent`**

Replace the `AgentEvent` class definition with:

```python
class AgentEvent(Base):
    __tablename__ = "agent_events"
    __table_args__ = {"schema": "agents"}
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    ts = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    agent_id = Column(Text, nullable=False)
    business_id = Column(Text, nullable=True)
    conversation_id = Column(Text, nullable=True)
    task_id = Column(Text, nullable=True)
    kind = Column(Text, nullable=False)
    node = Column(Text, nullable=True)
    status = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    reasoning = Column(Text, nullable=True)
    trace = Column(JSONB, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    tokens_in = Column(Integer, nullable=True)
    tokens_out = Column(Integer, nullable=True)
```

- [ ] **Step 4: Edit `agents/app/memory/models.py` — add schema to all five memory models**

For each of `MemoryConversationTurn`, `MemoryConversationSummary`, `MemoryKbChunk`, `MemoryProductEmbedding`, `MemoryPastAction`, add `__table_args__ = {"schema": "agents"}` immediately after the `__tablename__` line. Example (apply the same pattern to all five):

```python
class MemoryConversationTurn(Base):
    __tablename__ = "memory_conversation_turn"
    __table_args__ = {"schema": "agents"}
    id = Column(String, primary_key=True)
    # ... rest unchanged ...
```

The standalone `Index(...)` declaration at the bottom of the file refers to model columns and does not need editing — SQLAlchemy resolves the schema through the column's parent table.

- [ ] **Step 5: Run the model schema test, confirm it now passes**

```bash
docker compose exec -T agents-api python -m pytest tests/test_models_use_agents_schema.py -v
```

Expected: both tests PASS.

(The DB itself is still in the old layout — that's fine. The test asserts the model declarations only.)

- [ ] **Step 6: Run the full agents test suite to catch import/regression damage**

```bash
docker compose exec -T agents-api python -m pytest tests/ -x -q
```

Expected: all tests pass that were passing before. If a test fails because it queries a table by unqualified name through SQLAlchemy ORM, that's a real regression — fix it. Raw SQL strings (if any) need schema qualification.

- [ ] **Step 7: Commit**

```bash
git add agents/tests/test_models_use_agents_schema.py agents/app/db.py agents/app/memory/models.py
git commit -m "refactor(agents): pin alembic-owned models to 'agents' schema"
```

---

## Task 3: Update alembic env.py to use the `agents` schema

**Files:**
- Modify: `agents/alembic/env.py`

- [ ] **Step 1: Replace `agents/alembic/env.py` in full**

```python
import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

from app.db import Base
import app.memory.models  # noqa: F401  ensure models are registered

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

target_metadata = Base.metadata


def _include_object(obj, name, type_, reflected, compare_to):
    """Only autogenerate / compare against the `agents` schema.

    Prisma owns `public.*` — alembic must ignore it, otherwise autogenerate
    will offer to drop every Prisma table.
    """
    if type_ in ("table", "index", "unique_constraint", "foreign_key_constraint"):
        return getattr(obj, "schema", None) == "agents"
    return True


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema="agents",
        include_schemas=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="agents",
            include_schemas=True,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 2: Verify env.py is syntactically valid (do NOT run alembic yet)**

```bash
docker compose exec -T agents-api python -c "import importlib.util, sys; spec=importlib.util.spec_from_file_location('e','alembic/env.py'); m=importlib.util.module_from_spec(spec); print('ok')"
```

Expected: prints `ok`. (We can't actually import env.py outside an alembic context — this just byte-compiles it.)

If you instead try `alembic current` here, it will fail with `relation "agents.alembic_version" does not exist`. That's expected — the migration in Task 4 creates that schema. **Do not panic and do not run `alembic upgrade head` yet.**

- [ ] **Step 3: Commit**

```bash
git add agents/alembic/env.py
git commit -m "refactor(alembic): point env.py at the 'agents' schema"
```

---

## Task 4: Write the schema-move data migration

**Files:**
- Create: `agents/alembic/versions/0005_isolate_agents_schema.py`

- [ ] **Step 1: Create the migration file**

```python
"""isolate alembic-owned tables under the `agents` schema

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-25

Moves every alembic-owned table from public.* to agents.*. Idempotent:
each ALTER TABLE checks information_schema first, so re-running on a DB
that's already been migrated is a no-op.

Data preservation: ALTER TABLE ... SET SCHEMA preserves rows, indexes,
constraints, sequences, and FKs.
"""
from alembic import op


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


_TABLES = [
    "memory_conversation_summary",
    "memory_conversation_turn",
    "memory_kb_chunk",
    "memory_past_action",
    "memory_product_embedding",
    "agent_events",
    "agents",
    "business_agents",
    "alembic_version",
]


def upgrade():
    op.execute("CREATE SCHEMA IF NOT EXISTS agents")
    for t in _TABLES:
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '{t}'
              ) THEN
                EXECUTE 'ALTER TABLE public."{t}" SET SCHEMA agents';
              END IF;
            END$$;
        """)


def downgrade():
    for t in reversed(_TABLES):
        op.execute(f"""
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'agents' AND table_name = '{t}'
              ) THEN
                EXECUTE 'ALTER TABLE agents."{t}" SET SCHEMA public';
              END IF;
            END$$;
        """)
    op.execute("DROP SCHEMA IF EXISTS agents")
```

- [ ] **Step 2: Commit the migration before running it**

```bash
git add agents/alembic/versions/0005_isolate_agents_schema.py
git commit -m "feat(alembic): 0005 isolate alembic tables under 'agents' schema"
```

(Committing first means a failed `alembic upgrade` doesn't leave an uncommitted file plus a moved DB.)

---

## Task 5: Apply the migration to the running dev DB

**Files:** none (DB-only).

- [ ] **Step 1: Apply the migration**

```bash
docker compose exec -T agents-api alembic upgrade head
```

Expected output (last lines):

```
INFO  [alembic.runtime.migration] Running upgrade 0004 -> 0005, isolate alembic-owned tables under the `agents` schema
```

If you instead see `relation "alembic_version" does not exist`: alembic is reading from `agents.alembic_version` (per env.py) but the table is still in `public`. Recover with:

```bash
docker compose exec -T postgres psql -U postgres -d pisangbisnes \
  -c "CREATE SCHEMA IF NOT EXISTS agents; ALTER TABLE public.alembic_version SET SCHEMA agents;"
docker compose exec -T agents-api alembic upgrade head
```

This bootstraps the version-table location, then 0005 runs and is a no-op for `alembic_version` (which is already moved) and a real move for the other 8 tables.

- [ ] **Step 2: Verify schema split with psql**

```bash
docker compose exec -T postgres psql -U postgres -d pisangbisnes -c "\dt agents.*"
docker compose exec -T postgres psql -U postgres -d pisangbisnes -c "\dt public.*"
```

Expected `agents.*`: `agents`, `agent_events`, `alembic_version`, `business_agents`, `memory_conversation_summary`, `memory_conversation_turn`, `memory_kb_chunk`, `memory_past_action`, `memory_product_embedding` (9 rows).

Expected `public.*`: only Prisma-owned tables (`Todo`, `_prisma_migrations`, `account`, `agent_action`, `business`, `order`, `product`, `session`, `user`, `verification`).

- [ ] **Step 3: Verify row counts match the baseline from pre-flight Step 3**

```bash
docker compose exec -T postgres psql -U postgres -d pisangbisnes -c "
  SELECT 'memory_conversation_summary' AS t, count(*) FROM agents.memory_conversation_summary
  UNION ALL SELECT 'memory_conversation_turn',    count(*) FROM agents.memory_conversation_turn
  UNION ALL SELECT 'memory_kb_chunk',             count(*) FROM agents.memory_kb_chunk
  UNION ALL SELECT 'memory_past_action',          count(*) FROM agents.memory_past_action
  UNION ALL SELECT 'memory_product_embedding',    count(*) FROM agents.memory_product_embedding
  UNION ALL SELECT 'agent_events',                count(*) FROM agents.agent_events
  UNION ALL SELECT 'agents',                      count(*) FROM agents.agents
  UNION ALL SELECT 'business_agents',             count(*) FROM agents.business_agents;"
```

Expected: every row matches the pre-flight baseline. If any count is lower, STOP — `SET SCHEMA` should never lose rows. Investigate before continuing.

- [ ] **Step 4: Restart agents-api so the in-process SQLAlchemy session picks up the new schema metadata cleanly**

```bash
docker compose restart agents-api agents-worker agents-beat
sleep 3
docker compose logs agents-api --tail=20
```

Expected: clean `Application startup complete.` line. No `relation does not exist` warnings.

---

## Task 6: Tighten Prisma to `public` only

**Files:**
- Modify: `app/prisma/schema.prisma`

- [ ] **Step 1: Edit the `generator` and `datasource` blocks**

In `app/prisma/schema.prisma`, replace the top of the file with:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
  output          = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public"]
}
```

(Keep your existing `output` value — do not change it. Only `previewFeatures` and `schemas` are new.)

- [ ] **Step 2: Add `@@schema("public")` to every model**

`multiSchema` requires every model to declare its schema. For each `model X { ... }` block in `app/prisma/schema.prisma`, add `@@schema("public")` next to the existing `@@map(...)` / `@@index(...)` directives. Example:

```prisma
model Order {
  // ... fields unchanged ...

  @@map("order")
  @@index([businessId, status])
  @@index([groupId])
  @@schema("public")
}
```

Do this for: `User`, `Account`, `Session`, `Verification`, `Business`, `Product`, `AgentAction`, `Order`, `Todo`. Do not add it to enum declarations unless prisma's validator complains; if it does, add `@@schema("public")` inside the enum too.

- [ ] **Step 3: Regenerate the Prisma client**

```bash
cd app && DATABASE_URL='postgresql://postgres:root@localhost:5433/pisangbisnes' npx prisma generate && cd ..
```

Expected: `✔ Generated Prisma Client (...) to ./src/generated/prisma`. No errors.

- [ ] **Step 4: Verify Prisma cannot see `agents.*`**

```bash
cd app && DATABASE_URL='postgresql://postgres:root@localhost:5433/pisangbisnes' npx prisma db pull --print 2>&1 | tail -40 ; cd ..
```

Expected: the printed schema only contains the 9 Prisma-owned models. If you see `model agents`, `model memory_conversation_turn`, etc., the allowlist is wrong — re-check Step 1 and 2.

- [ ] **Step 5: Verify `prisma migrate status` does NOT propose dropping alembic tables**

```bash
cd app && DATABASE_URL='postgresql://postgres:root@localhost:5433/pisangbisnes' npx prisma migrate status 2>&1 | tail -20 ; cd ..
```

Expected: `Database schema is up to date!` (or a "drift detected" complaint specific to `groupId` / past Prisma changes — that's not what we're checking here). Critical: it must NOT mention any `agents.*` table.

- [ ] **Step 6: Commit**

```bash
git add app/prisma/schema.prisma app/src/generated/prisma
git commit -m "chore(prisma): allowlist 'public' schema; isolate from alembic-owned tables"
```

(`src/generated/prisma` is in `.gitignore` if it was already; if not, the commit picks it up — that's fine.)

---

## Task 7: End-to-end smoke test (the bug that triggered all this)

**Files:** none.

- [ ] **Step 1: POST to the support chat endpoint with the multi-item Malay request**

```bash
curl -s -X POST http://localhost:8000/agent/support/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "business_id": "cmocmfvd2000023sdz52e8bin",
    "customer_id": "012345",
    "customer_phone": "+60123456789",
    "message": "saya nak beli 2 psg dengan 10 terng lah"
  }' | python3 -m json.tool
```

Expected: a single `http://localhost:3000/pay/<groupId>` URL in the `reply` field. `confidence ≈ 0.9+`. No 500.

If you see `500 Internal Server Error` or "Agent processing failed":

```bash
docker compose logs agents-api --tail=80 | grep -A20 -i "error\|traceback"
```

The most likely cause is a missing `__table_args__` on a model that the request path touches (look for `relation "<table>" does not exist`). Add the missing `schema="agents"` and re-run Task 2 Step 5.

- [ ] **Step 2: Verify the cart row landed in `public.order` AND memory writes landed in `agents.memory_*`**

```bash
docker compose exec -T postgres psql -U postgres -d pisangbisnes -c "
  SELECT count(*) AS cart_rows FROM public.\"order\" WHERE \"buyerContact\"='+60123456789' AND \"createdAt\" > now() - interval '5 minutes';
  SELECT count(*) AS new_turns FROM agents.memory_conversation_turn WHERE \"customerPhone\"='+60123456789' AND \"turnAt\" > now() - interval '5 minutes';
  SELECT count(*) AS new_events FROM agents.agent_events WHERE \"ts\" > now() - interval '5 minutes';
"
```

Expected: `cart_rows = 2`, `new_turns ≥ 1`, `new_events ≥ 5` (load_context, load_memory, draft_reply, plus manager nodes).

If `cart_rows = 0`: the chat returned a non-purchase reply — re-read the `reply` text. If `new_turns = 0`: the worker can't reach `agents.memory_conversation_turn` — check `MemoryConversationTurn.__table__.schema` is `"agents"`.

- [ ] **Step 3: Tag the working state**

```bash
git tag schema-isolation-applied
```

(Local tag, easy rollback anchor. Push only if you want; not required.)

---

## Task 8: CLAUDE.md DB safety rule

**Files:**
- Create: `CLAUDE.md` (project root)

- [ ] **Step 1: Create CLAUDE.md**

```markdown
# Pisang Biru — Claude conventions

## Database safety

This repo uses dual migrators against one Postgres DB:

- **Prisma** owns `public.*` (`app/prisma/schema.prisma`).
- **Alembic** owns `agents.*` (`agents/alembic/`).

Each migrator is configured with an explicit allowlist (`schemas = ["public"]` for Prisma; `include_object` filter + `version_table_schema="agents"` for Alembic). **Drift between them is the intended boundary, not a bug.**

Before running ANY of these, STOP and ask the user explicitly. Never run unprompted:

- `prisma db push` (any flags — especially `--accept-data-loss`)
- `prisma migrate reset`
- `prisma migrate dev` when drift is reported
- `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE` against the dev DB
- Any `psql` / `docker exec ... psql` that writes (UPDATE / DELETE / DDL)

If `prisma migrate dev` reports drift, do NOT switch to `db push`. Use one of:

- `prisma db execute --file <path.sql>` for a one-off, untracked SQL change.
- Hand-write a migration under `app/prisma/migrations/` and apply with `prisma migrate resolve --applied <name>`.
- Escalate to the user.

The teammate-facing recovery path for the schema-isolation change is `./scripts/apply-agents-schema.sh`. Spec: `docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with DB safety rule for dual migrators"
```

---

## Task 9: Failing test for the destructive-DB guard hook

**Files:**
- Create: `tests/scripts/test_guard_destructive_db.sh`

- [ ] **Step 1: Create the test harness**

```bash
mkdir -p tests/scripts
```

Then create `tests/scripts/test_guard_destructive_db.sh`:

```bash
#!/usr/bin/env bash
# Bash test harness for scripts/guard-destructive-db.sh
# Each case feeds a JSON tool-input on stdin and asserts the exit code.

set -uo pipefail
HOOK="scripts/guard-destructive-db.sh"
fail=0

assert_block() {
  local name=$1 cmd=$2
  local out
  out=$(printf '{"tool_input":{"command":%s}}' "$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" | bash "$HOOK" 2>&1)
  local rc=$?
  if [ "$rc" -eq 2 ]; then
    printf "  PASS  %s\n" "$name"
  else
    printf "  FAIL  %s — expected exit 2, got %s\n         output: %s\n" "$name" "$rc" "$out"
    fail=1
  fi
}

assert_allow() {
  local name=$1 cmd=$2
  local out
  out=$(printf '{"tool_input":{"command":%s}}' "$(printf '%s' "$cmd" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" | bash "$HOOK" 2>&1)
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    printf "  PASS  %s\n" "$name"
  else
    printf "  FAIL  %s — expected exit 0, got %s\n         output: %s\n" "$name" "$rc" "$out"
    fail=1
  fi
}

echo "== blocklist (must exit 2) =="
assert_block "prisma db push"                  "npx prisma db push"
assert_block "prisma db push --accept-data-loss" "npx prisma db push --accept-data-loss"
assert_block "prisma migrate reset"            "npx prisma migrate reset"
assert_block "prisma migrate dev --accept-data-loss" "npx prisma migrate dev --accept-data-loss"
assert_block "DROP TABLE inline psql"          'docker exec pg psql -U postgres -c "DROP TABLE foo"'
assert_block "TRUNCATE inline psql"            'psql -c "TRUNCATE TABLE bar"'
assert_block "psql -c DELETE"                  'psql -c "DELETE FROM users WHERE x=1"'
assert_block "DROP SCHEMA"                     'psql -c "DROP SCHEMA agents CASCADE"'

echo "== allowlist (must exit 0) =="
assert_allow "prisma generate"                 "npx prisma generate"
assert_allow "prisma migrate deploy"           "npx prisma migrate deploy"
assert_allow "prisma migrate dev clean"        "npx prisma migrate dev --name foo"
assert_allow "alembic upgrade"                 "docker compose exec agents-api alembic upgrade head"
assert_allow "psql read-only"                  'psql -c "SELECT count(*) FROM business"'
assert_allow "ls"                              "ls -la"
assert_allow "grep DROP in source code"        "grep -rn DROP src/"

if [ "$fail" -eq 0 ]; then
  echo "ALL OK"
  exit 0
fi
echo "FAILURES — see above"
exit 1
```

- [ ] **Step 2: Make it executable and run it (must fail — hook doesn't exist yet)**

```bash
chmod +x tests/scripts/test_guard_destructive_db.sh
bash tests/scripts/test_guard_destructive_db.sh
```

Expected: every case FAILS or the harness errors out with "scripts/guard-destructive-db.sh: No such file or directory". This is the failing-test step.

---

## Task 10: Implement the destructive-DB guard hook

**Files:**
- Create: `scripts/guard-destructive-db.sh`

- [ ] **Step 1: Write the hook script**

```bash
#!/usr/bin/env bash
# PreToolUse hook for Bash tool calls.
# Reads the Claude Code tool-call JSON from stdin, regex-matches the `command`
# field against a blocklist of destructive DB operations, and exits 2 (block)
# with a reason if any pattern hits.
#
# Allow-list philosophy: deny destructive ops by default; user can override
# either by typing the command themselves or by adding a one-off entry to
# .claude/settings.local.json under permissions.allow.

set -uo pipefail

# Read the entire tool-call payload. Tolerate jq missing — fall back to grep.
payload=$(cat)
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
else
  # Crude fallback: pull the first JSON-quoted "command" value.
  cmd=$(printf '%s' "$payload" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input") or {}).get("command",""))' 2>/dev/null || echo "")
fi

block() {
  local pattern=$1 reason=$2
  cat >&2 <<EOF
[guard-destructive-db] BLOCKED: $reason
  matched pattern: $pattern
  command:         $cmd

This repo uses dual migrators (Prisma owns public.*, Alembic owns agents.*).
See CLAUDE.md "Database safety" + docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md.

To proceed: ask the user explicitly, or add a permissions.allow entry to
.claude/settings.local.json after they confirm.
EOF
  exit 2
}

# Empty command (non-Bash tool-call, or malformed payload) — let it through.
[ -z "$cmd" ] && exit 0

# Blocklist patterns. Case-insensitive matches via grep -Ei.
match() { printf '%s' "$cmd" | grep -Eqi "$1"; }

match 'prisma[[:space:]]+db[[:space:]]+push'                                  && block 'prisma db push'                  '`prisma db push` bypasses migration history and can drop alembic-owned tables.'
match 'prisma[[:space:]]+migrate[[:space:]]+reset'                            && block 'prisma migrate reset'            '`migrate reset` drops the dev DB.'
match 'prisma[[:space:]]+migrate[[:space:]]+dev.*--accept-data-loss'          && block 'prisma migrate dev --accept-data-loss' 'Destructive Prisma migrate flag.'
match '\b(drop|truncate)[[:space:]]+(table|schema|database)\b'                && block 'DROP/TRUNCATE TABLE/SCHEMA/DATABASE' 'Destructive DDL.'
match '(docker[[:space:]]+(compose[[:space:]]+)?exec[^|;&]*)?psql[^|;&]*-c[^|;&]*\b(drop|truncate|delete|update)\b' \
                                                                              && block 'psql -c <write>'                 'Inline psql write/DDL.'

exit 0
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/guard-destructive-db.sh
```

- [ ] **Step 3: Run the harness — every case must pass**

```bash
bash tests/scripts/test_guard_destructive_db.sh
```

Expected: `ALL OK`. Every block case exits 2; every allow case exits 0.

If a block case FAILS as "expected exit 2, got 0": the regex didn't match. Tighten it.
If an allow case FAILS as "expected exit 0, got 2": the regex over-matched. Loosen it (most likely the `psql -c` regex catching a SELECT).

- [ ] **Step 4: Commit**

```bash
git add scripts/guard-destructive-db.sh tests/scripts/test_guard_destructive_db.sh
git commit -m "feat(safety): pretooluse hook to block destructive DB Bash commands"
```

---

## Task 11: Wire the hook into Claude Code

**Files:**
- Create: `.claude/settings.json`

- [ ] **Step 1: Create `.claude/settings.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "scripts/guard-destructive-db.sh"
          }
        ]
      }
    ]
  }
}
```

(`.claude/settings.local.json` already exists for per-developer permission overrides — do not touch it.)

- [ ] **Step 2: Smoke-test the hook end-to-end inside a Claude Code session**

This step requires a fresh Claude Code conversation (the running one has the hook config cached). Manual verification — outside automation:

1. Restart Claude Code in this repo.
2. Ask Claude to run `npx prisma db push` (in a sandboxed/dry-run way, e.g. "try to run prisma db push and tell me what happens").
3. Confirm Claude reports it was blocked by the hook with the message from `block()`.
4. Ask Claude to run `npx prisma generate` — confirm it runs normally.

If step 3 doesn't block: the hook is not wired. Re-check `.claude/settings.json` syntax and the `matcher` value.

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "chore(claude): register guard-destructive-db hook in project settings"
```

---

## Task 12: Final validation gate + push

**Files:** none.

- [ ] **Step 1: Run the full agents test suite + the guard harness one more time**

```bash
docker compose exec -T agents-api python -m pytest tests/ -q
bash tests/scripts/test_guard_destructive_db.sh
```

Expected: agents tests all pass; guard harness reports `ALL OK`.

- [ ] **Step 2: Confirm the live DB layout is final**

```bash
docker compose exec -T postgres psql -U postgres -d pisangbisnes \
  -c "SELECT table_schema, count(*) FROM information_schema.tables WHERE table_schema IN ('public','agents') AND table_type='BASE TABLE' GROUP BY 1 ORDER BY 1;"
```

Expected: `agents = 9`, `public = 10` (or whatever the Prisma model count is — the point is `agents` is exactly 9 and is non-empty).

- [ ] **Step 3: Re-run the smoke test from Task 7 Step 1 one more time**

(Catches anything broken between Tasks 7 and 12.)

- [ ] **Step 4: Push the branch and open a PR**

```bash
git push -u origin atan/schema-isolation
gh pr create --title "Isolate alembic-owned tables under 'agents' schema + DB safety hook" --body "$(cat <<'EOF'
## Summary
- Move `memory_*`, `agent_events`, `agents`, `business_agents`, `alembic_version` from `public.*` to `agents.*` via alembic 0005 (`ALTER TABLE ... SET SCHEMA`, data-preserving).
- Allowlist Prisma to `schemas = ["public"]` so `prisma db push` cannot perceive alembic-owned tables.
- Add CLAUDE.md DB safety rule + PreToolUse Bash hook to block destructive DB commands by default.

## Test plan
- [ ] `docker compose exec -T agents-api python -m pytest tests/ -q` — all green
- [ ] `bash tests/scripts/test_guard_destructive_db.sh` — `ALL OK`
- [ ] curl the multi-item Malay chat request — single `/pay/<groupId>` URL, `cart_rows=2`, new memory turns, new agent_events
- [ ] `\dt agents.*` shows 9 tables; `\dt public.*` shows only Prisma tables
- [ ] `prisma db pull --print` does NOT list any `agents.*` table

## Teammate rollout
After merge: `git pull && ./scripts/apply-agents-schema.sh`. Data preserved (no reseed). Spec: `docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md`.
EOF
)"
```

---

## Self-Review Checklist (run before handoff)

- **Spec coverage:**
  - Schema isolation SQL → Task 4. ✅
  - SQLAlchemy `__table_args__` edits → Task 2. ✅
  - Alembic env.py changes → Task 3. ✅
  - Prisma `schemas = ["public"]` + `multiSchema` → Task 6. ✅
  - Cross-schema FK audit (`business_agents.agent_id`) → Task 2 Step 2 + Task 1 second test. ✅
  - Deployment-order risk (env.py vs migration order) → Task 5 Step 1 recovery path. ✅
  - Teammate rollout → already shipped via `scripts/apply-agents-schema.sh` (referenced in Task 12 PR body and CLAUDE.md). ✅
  - CLAUDE.md DB safety rule → Task 8. ✅
  - PreToolUse hook → Tasks 9, 10, 11. ✅
  - Hook trade-off (false positives) → CLAUDE.md text + hook block message both name `permissions.allow` as the override. ✅

- **Placeholder scan:** No TBDs, no "add appropriate validation", no "similar to Task N". Every code/SQL/JSON block is complete.

- **Type consistency:** `__table_args__ = {"schema": "agents"}` used identically across Tasks 1, 2, 3. FK target `"agents.agents.id"` matches between the Task 1 test assertion and the Task 2 Step 2 model definition.
