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
