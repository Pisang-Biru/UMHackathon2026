# Pisang Biru — UM Hackathon 2026

Agentic commerce assistant for small Malaysian sellers. Monorepo with two deployable units:

- `agents/` — FastAPI + LangGraph customer-support agent with pgvector-backed memory. Python 3.13, Celery worker + beat, RabbitMQ broker.
- `app/` — TanStack Start frontend with Prisma, Better Auth, tRPC.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Node 20+ and `pnpm`
- LLM credentials (OpenAI-compatible endpoint): `MODEL`, `API_KEY`, `OPENAI_API_BASE`

Export the LLM creds in your shell before `./scripts/dev.sh up`, or put them in `agents/.env` which the script sources:

```bash
export MODEL=gpt-4o-mini
export API_KEY=sk-...
export OPENAI_API_BASE=https://api.openai.com/v1
```

## Quickstart

```bash
git clone https://github.com/Pisang-Biru/UMHackathon2026.git
cd umhackathon2026

# backend (Postgres + pgvector, RabbitMQ, FastAPI, Celery worker + beat)
./scripts/dev.sh up

# in another terminal: TS frontend (stays on host for fast HMR)
cd app
pnpm install
pnpm dev
```

First run takes ~5 minutes: it builds the agents image (3 min), downloads `BAAI/bge-m3` (~2 GB, 1–2 min), runs prisma + alembic migrations, and seeds a demo business.

When the stack is ready:

| Service | URL |
|---|---|
| TS frontend | `http://localhost:3000` |
| Agents API | `http://localhost:8000` |
| RabbitMQ admin | `http://localhost:15672` (`guest` / `guest`) |
| Postgres | `localhost:5433` (`postgres` / `root` / `pisangbisnes`) |

## Daily commands

```bash
./scripts/dev.sh up           # start everything
./scripts/dev.sh down         # stop (volumes preserved)
./scripts/dev.sh ps           # see container status
./scripts/dev.sh logs         # tail api + worker
./scripts/dev.sh logs agents-beat  # tail a specific service
./scripts/dev.sh psql         # psql into the DB
./scripts/dev.sh shell        # bash into agents-api
./scripts/dev.sh seed         # re-run seed (idempotent)
./scripts/dev.sh reset        # nuke volumes + rebuild from scratch
```

After editing Python in `agents/`, `uvicorn --reload` picks it up automatically. Celery worker does NOT hot-reload — restart it when task code changes:

```bash
docker compose restart agents-worker
```

## Smoke test

```bash
curl -s -X POST http://localhost:8000/agent/support/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "business_id": "dev-biz",
    "customer_id": "c1",
    "customer_phone": "+60123456789",
    "message": "nak beli 2 pisang hijau"
  }' | jq
```

Expected: a reply in Malay/English, optionally a payment link like `http://localhost:3000/pay/<id>`.

## Troubleshooting

**`ERROR: old container 'pgvector' is running`** — you have a leftover container from a previous manual setup. Remove it:

```bash
docker rm -f pgvector pisang-rabbitmq
```

**First run is slow** — the bge-m3 model is ~2 GB. It downloads once into a docker volume (`hf-cache`) and is reused across restarts.

**`500 Internal Server Error` on `/agent/support/chat`** — LLM creds missing. Check `echo $API_KEY` on the host, then `./scripts/dev.sh down && ./scripts/dev.sh up`.

**Celery worker crashes with `SIGABRT` on macOS** — the entrypoint uses `--pool=threads` which avoids the fork-safety issue with PyTorch + Apple Silicon. If you see this, confirm the entrypoint has `--pool=threads` and not `--pool=prefork`.

**Prisma migrate `P3005` (schema not empty)** — the init container runs prisma before alembic on purpose. If you manually ran alembic first on an empty DB, wipe with `./scripts/dev.sh reset`.

**Postgres data gone after a compose change** — the `pg-data` named volume is independent of your code. `./scripts/dev.sh reset` explicitly destroys it. Regular `./scripts/dev.sh down` preserves it.

## Project structure

```
agents/                   Python backend (FastAPI + LangGraph + Celery)
  app/
    agents/               customer_support graph
    memory/               pgvector embedder, repo, chunker, formatter
    routers/              /agent/*, /memory/*
    worker/               Celery app + tasks
  alembic/                SQLAlchemy migrations (memory tables)
  scripts/                preload_embedder.py, smoke_memory.py, seed_dev.py
  tests/                  pytest suite (47 tests)
  Dockerfile              multi-role image (api/worker/beat/init)
app/                      TypeScript frontend (TanStack + Prisma + tRPC)
  prisma/                 schema + migrations
  src/                    routes, components, server fns
docs/superpowers/         specs + implementation plans
scripts/dev.sh            docker compose lifecycle wrapper
docker-compose.yml        full dev stack
```
