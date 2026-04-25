# Pisang Biru — Claude conventions

## Database safety

This repo uses dual migrators against one Postgres DB:

- **Prisma** owns `public.*` (`app/prisma/schema.prisma`).
- **Alembic** owns `agents.*` (`agents/alembic/`).

Each migrator is configured with an explicit allowlist (`schemas = ["public"]` for Prisma; `include_object` filter + `version_table_schema="agents"` for Alembic). **Drift between them is the intended boundary, not a bug.**

**Always ask the user before running any DB-mutating command.** This includes (but is not limited to):

- `prisma db push` (any flags — especially `--accept-data-loss`)
- `prisma migrate reset`
- `prisma migrate dev` (whether or not drift is reported)
- `prisma db execute --file <path.sql>`
- `prisma migrate resolve --applied <name>`
- `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE` against the dev DB
- Any `psql` / `docker exec ... psql` that writes (UPDATE / DELETE / DDL)

When asking, present the safest option that achieves the user's goal first (typically a hand-written migration + `migrate resolve --applied`), but `db push` and `migrate reset` are permitted when the user explicitly approves them.

The teammate-facing recovery path for the schema-isolation change is `./scripts/apply-agents-schema.sh`. Spec: `docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md`.
