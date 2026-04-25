# Schema Isolation + DB Safety Hooks

**Date:** 2026-04-25
**Status:** Design — pending user review

## Problem

The repo runs two migrators against one Postgres database:

- **Prisma** (TypeScript, `app/prisma/schema.prisma`) owns the user-facing app: `business`, `product`, `order`, `agent_action`, `account`, `session`, `user`, `verification`, `Todo`.
- **Alembic** (Python, `agents/alembic/`) owns the agent runtime: `memory_conversation_summary`, `memory_conversation_turn`, `memory_kb_chunk`, `memory_past_action`, `memory_product_embedding`, `agent_events`, `agents`, `business_agents`, `alembic_version`.

Both write to the `public` schema. Each migrator only knows its own subset, so to each side the other's tables look like "drift". When `prisma migrate dev` reported drift on 2026-04-25 we fell back to `prisma db push --accept-data-loss`, which silently dropped 9 alembic-owned tables and ~880 rows of agent telemetry, memory turns, and embeddings. Recovery required re-running `agents-init` (Prisma migrate + alembic upgrade + seed) and manually re-invoking `upsert_registry()`.

This is a structural hazard, not a one-off mistake. Any future schema change on the Prisma side will hit the same drift trap.

## Goals

1. **Eliminate the drift.** A `prisma` command should not be able to perceive or modify alembic-owned tables.
2. **Backstop the human/agent.** When destructive DB commands are issued by Claude Code, block them by default and require explicit user override.
3. **Document the rule.** Future contributors (human or LLM) understand why dual migrators co-exist and which one owns what.

Out of scope: automated DB snapshots / point-in-time recovery (dev-only DB, manual recovery via `agents-init` is good enough).

## Approach

### A. Schema isolation (the structural fix)

Move every alembic-owned table out of `public` into a new schema, `agents`. After the move, Prisma's introspection and `db push` will not see those tables; Alembic only autogenerates against the `agents` schema.

#### One-time SQL migration

Run as either an alembic data migration (`alembic/versions/0005_isolate_agents_schema.py`) or a hand-applied `prisma db execute --file`. Idempotent and zero-downtime — `ALTER TABLE ... SET SCHEMA` preserves data, indexes, FKs, and sequences.

```sql
CREATE SCHEMA IF NOT EXISTS agents;

ALTER TABLE public.memory_conversation_summary SET SCHEMA agents;
ALTER TABLE public.memory_conversation_turn    SET SCHEMA agents;
ALTER TABLE public.memory_kb_chunk             SET SCHEMA agents;
ALTER TABLE public.memory_past_action          SET SCHEMA agents;
ALTER TABLE public.memory_product_embedding    SET SCHEMA agents;
ALTER TABLE public.agent_events                SET SCHEMA agents;
ALTER TABLE public.agents                      SET SCHEMA agents;  -- public.agents → agents.agents
ALTER TABLE public.business_agents             SET SCHEMA agents;
ALTER TABLE public.alembic_version             SET SCHEMA agents;
```

Table names are kept (decision: live with `agents.agents`; renaming costs more than it saves).

#### SQLAlchemy model edits

Add `__table_args__ = {"schema": "agents"}` to:

- `agents/app/db.py` — `Agent`, `BusinessAgent`, `AgentEvent`
- `agents/app/memory/models.py` — all five `MemoryConversation*`, `MemoryKbChunk`, `MemoryPastAction`, `MemoryProductEmbedding`

If a model uses `Column(..., ForeignKey("public.business.id"))` style references, qualify the FK target string explicitly (Prisma-owned tables remain in `public`). Cross-schema FKs are legal in Postgres.

#### Alembic env.py edits

In `agents/alembic/env.py` `context.configure(...)`:

```python
context.configure(
    connection=connection,
    target_metadata=target_metadata,
    version_table_schema="agents",
    include_schemas=True,
    include_object=lambda obj, name, type_, reflected, compare_to: (
        # Only autogenerate for our schema. Ignore Prisma-owned public tables.
        getattr(obj, "schema", None) == "agents"
        if type_ in ("table", "index", "unique_constraint", "foreign_key_constraint")
        else True
    ),
)
```

`version_table_schema="agents"` makes alembic store its bookkeeping at `agents.alembic_version` (matches the `SET SCHEMA` above). `include_schemas=True` plus `include_object` filter keeps autogenerate from proposing destructive ops against Prisma tables.

#### Prisma config edits

`app/prisma/schema.prisma`:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public"]
}
```

The `schemas = ["public"]` allowlist means `prisma migrate dev`, `prisma db push`, and `prisma db pull` only ever introspect or modify `public.*`. The `agents` schema is invisible to Prisma — including the `--accept-data-loss` path.

#### Cross-schema FK audit

Current state: `business_agents.business_id` is `Text` (not a Postgres FK). No alembic-managed table has a real FK into `public`. After the move, no cross-schema FKs exist. If any are added later, qualify them: `ForeignKey("public.business.id")`.

#### Raw SQL audit

Grep confirms no hard-coded `FROM memory_*` or `FROM agent_events` outside SQLAlchemy ORM access. SQLAlchemy emits schema-qualified SQL automatically once `__table_args__` is set, so callers don't change.

#### Rollback

If the move breaks something:

```sql
ALTER TABLE agents.memory_conversation_summary SET SCHEMA public;
-- ...etc for each table
DROP SCHEMA agents;
```

Then revert the four code changes (models, alembic env, Prisma datasource) in one revert commit.

### B. Process safety (the backstop)

Two layers, both required.

#### Layer 1: CLAUDE.md rule

Append to `CLAUDE.md` (or `agents/CLAUDE.md` if scope-limited):

```md
## Database safety

This repo uses dual migrators:
- Prisma owns `public.*` (user-facing app schema, `app/prisma/schema.prisma`).
- Alembic owns `agents.*` (memory, telemetry, registry, `agents/alembic/`).

Each migrator is configured to ignore the other's schema. Drift between them is
**not** real drift — it is the intended boundary. Do NOT resolve drift by running
destructive Prisma commands.

Before running any of these, STOP and ask the user explicitly:

- `prisma db push` (any flags — especially `--accept-data-loss`)
- `prisma migrate reset`
- `prisma migrate dev` when drift is reported
- `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE` against the dev DB
- Any `psql` / `docker exec ... psql` that writes (UPDATE / DELETE / DDL)

If `prisma migrate dev` reports drift, do NOT switch to `db push`. Either:
- write the migration SQL by hand and apply via `prisma migrate resolve --applied`, or
- use `prisma db execute --file <path.sql>` for a non-tracked one-off, or
- escalate to the user.
```

#### Layer 2: PreToolUse Bash hook

`.claude/settings.json` (project-scoped):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "scripts/guard-destructive-db.sh" }
        ]
      }
    ]
  }
}
```

`scripts/guard-destructive-db.sh` reads the tool input JSON from stdin, regex-matches the `command` field against a blocklist, and exits with code 2 (block + show reason to Claude) if any pattern hits. Patterns:

| Regex (case-insensitive) | Reason shown |
|---|---|
| `prisma\s+db\s+push` | `prisma db push` bypasses migration history; ask user first. |
| `prisma\s+migrate\s+reset` | `migrate reset` drops the dev DB; ask user first. |
| `prisma\s+migrate\s+dev.*--(accept-data-loss\|create-only)` | `migrate dev` with destructive flags; ask user first. |
| `\b(DROP\|TRUNCATE)\s+(TABLE\|SCHEMA\|DATABASE)\b` | DDL drop/truncate; ask user first. |
| `psql.*-c.*\b(DROP\|TRUNCATE\|DELETE\|UPDATE)\b` | Inline psql write; ask user first. |
| `docker\s+exec.*psql.*-c.*\b(DROP\|TRUNCATE\|DELETE\|UPDATE)\b` | Containerised psql write; ask user first. |

Each block message points at the CLAUDE.md rule and lists the matched pattern. The user can unblock by:

1. typing the command themselves (hooks don't run on user-typed shell input the same way),
2. adding a one-off `permissions.allow` entry in `.claude/settings.local.json`, or
3. asking Claude to rephrase / split the command.

#### False-positive trade-off

The hook will occasionally block legitimate use — e.g. a fresh `prisma migrate dev` on a green-field branch. We accept this. Cost of a false positive: 30 seconds to add a settings exception. Cost of a false negative (the original incident): hours of recovery + lost telemetry. Asymmetric, hook wins.

## File touch list

- `app/prisma/schema.prisma` — add `previewFeatures = ["multiSchema"]`, `schemas = ["public"]`.
- `agents/app/db.py` — `__table_args__ = {"schema": "agents"}` on `Agent`, `BusinessAgent`, `AgentEvent`.
- `agents/app/memory/models.py` — same on each memory model.
- `agents/alembic/env.py` — `version_table_schema`, `include_schemas`, `include_object`.
- `agents/alembic/versions/0005_isolate_agents_schema.py` — new data migration with the `CREATE SCHEMA` + `ALTER TABLE ... SET SCHEMA` block.
- `CLAUDE.md` (or `agents/CLAUDE.md`) — DB safety section.
- `.claude/settings.json` — PreToolUse hook entry.
- `scripts/guard-destructive-db.sh` — new executable, +x, regex matcher.

## Deployment order (matters)

The env.py change and the migration script have a chicken-and-egg risk: if `version_table_schema="agents"` is set in env.py before migration 0005 runs, alembic looks at `agents.alembic_version` (does not exist yet), assumes the DB is fresh, and tries to re-run every migration from 0001.

Apply in this order:

1. **First commit** (data migration only) — add `0005_isolate_agents_schema.py` with the `CREATE SCHEMA` + `ALTER TABLE ... SET SCHEMA` block. Do NOT change env.py yet. Run `alembic upgrade head` against dev. After this step, alembic still reads from `public.alembic_version` — but that table has just been moved to `agents.alembic_version`, so the next alembic invocation against the unchanged env.py would fail. Treat the DB as in a transient state; the next commit must land before any further alembic run.
2. **Second commit (same PR, applied immediately after)** — flip env.py to `version_table_schema="agents"`, add `include_schemas=True` + `include_object` filter, add `__table_args__ = {"schema": "agents"}` to all models, update Prisma `schemas = ["public"]`. Restart agents-api.

Rolling these into one PR (two ordered commits) keeps the window where the DB is "moved but env.py not flipped" to seconds. CI runs `alembic upgrade head` once per PR — it must complete before tests.

## Rollout to teammates with existing DBs

Teammates already have their dev DB seeded in the old layout (everything in `public`). They must NOT `prisma db push` or wipe the DB to "get clean" — that re-creates the original incident. Instead, the alembic data migration is designed so a `git pull` + `alembic upgrade head` is enough to converge.

### Per-developer steps (post-merge)

```bash
git pull
docker compose pull         # if image changed
docker compose up -d postgres rabbitmq redis
docker compose run --rm agents-init  # runs prisma migrate deploy + alembic upgrade head + seed (idempotent)
docker compose restart agents-api agents-worker agents-beat
```

`agents-init` already chains `prisma migrate deploy` then `alembic upgrade head`. Migration `0005_isolate_agents_schema.py` (a) creates the `agents` schema and (b) moves the 9 tables. `ALTER TABLE ... SET SCHEMA` is data-preserving — every teammate keeps their existing memory turns, embeddings, and event history.

### Why the order is safe for them

The same Deployment-order risk above applies to teammates, but it is contained inside the single `agents-init` invocation:

1. `prisma migrate deploy` — no-op if Prisma history is current; otherwise applies new Prisma migrations against `public` only (after the schema-allowlist change lands, Prisma cannot touch `agents.*`).
2. `alembic upgrade head` — runs 0005 against the still-`public.alembic_version` row, then alembic immediately commits and exits.
3. The next alembic invocation reads from the new `agents.alembic_version` location because env.py (in the same commit) sets `version_table_schema="agents"`.

Because steps 2 and 3 are separate process invocations, the env.py flag is already in place by the time anyone reads the version table again. No transient broken window for end users.

### Sanity check after pull

Each teammate runs:

```bash
docker compose exec postgres psql -U postgres -d pisangbisnes -c "\dt agents.*"
docker compose exec postgres psql -U postgres -d pisangbisnes -c "\dt public.*"
```

Expected: 9 tables under `agents.*`, Prisma-owned tables under `public.*`. Memory turn count, agent_events count, etc. should match pre-pull values (run `SELECT count(*)` before and after pulling to confirm `SET SCHEMA` preserved data).

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `alembic upgrade` errors `relation "alembic_version" does not exist` | Teammate ran a step out of order; env.py flipped to `agents` schema before 0005 ran. | `psql ... -c "ALTER TABLE public.alembic_version SET SCHEMA agents;"` then re-run `alembic upgrade head`. |
| Prisma reports drift after pull | Old Prisma client in `node_modules`. | `pnpm install && npx prisma generate`. |
| `agents-init` re-seeds and clobbers their dev data | Seed script is idempotent (uses `dev-biz` fixed id) but inserts demo rows. | Pass `SEED=false` to `agents-init`, or skip the init container entirely and run `alembic upgrade head` inside `agents-api` directly: `docker compose exec agents-api alembic upgrade head`. |
| `agents.agents` table empty after upgrade | Alembic `SET SCHEMA` moves the table but `upsert_registry()` only runs on `agents-api` startup. | `docker compose restart agents-api`, or run `docker compose exec agents-api python -c "from app.agents.registry import upsert_registry; upsert_registry()"`. |

### Communication

Post in the team channel before merging:

> Merging schema-isolation PR. After pulling: `docker compose run --rm agents-init && docker compose restart agents-api`. Your dev data is preserved (no reseed needed). If you see drift errors, do NOT run `prisma db push` — ping me. Spec: `docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md`.

## Validation

1. Apply alembic migration on dev DB. Confirm `\dt agents.*` in psql lists all 9 tables, `\dt public.*` lists only Prisma tables.
2. Run `prisma db pull` — confirm it produces a schema with only Prisma-owned tables (no proposal to delete `agents.*`).
3. Run `prisma migrate dev --create-only --name noop` — confirm it reports "no schema changes" rather than offering to drop alembic tables.
4. Restart `agents-api`, hit `POST /agent/support/chat` with the multi-item Malay request from the previous session, confirm orders + receipts + memory turns persist as expected.
5. Run `bash -c 'echo "{\"tool_input\":{\"command\":\"prisma db push\"}}" | scripts/guard-destructive-db.sh; echo exit=$?'` — confirm exit 2 with reason.

## Non-goals (explicitly deferred)

- Automated `pg_dump` snapshots — manual recovery via `agents-init` is sufficient for dev.
- Renaming `agents` table to `registry` — keep names, accept `agents.agents`.
- Migrating to a single ORM — Prisma + SQLAlchemy stay; isolation makes coexistence safe.
