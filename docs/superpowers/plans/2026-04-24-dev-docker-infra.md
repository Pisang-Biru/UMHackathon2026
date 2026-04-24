# Dev Docker Infra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `docker-compose.yml` + `scripts/dev.sh` + `agents/Dockerfile` so a fresh clone runs the full backend (Postgres+pgvector, RabbitMQ, FastAPI, Celery worker, Celery beat) with one command.

**Architecture:** One multi-role Docker image for the agents stack (API, worker, beat, init) with role selected at runtime via `$SERVICE_ROLE`. Postgres + RabbitMQ via official images. Migrations, bge-m3 preload, and seed run inside a one-shot `init` profile service. TS frontend stays on host; compose publishes Postgres on `localhost:5433` so `pnpm dev` keeps working.

**Tech Stack:** Docker Compose v2, `pgvector/pgvector:pg17`, `rabbitmq:3-management`, Python 3.13-slim base, Node 20 (for Prisma CLI inside init), bash.

**Spec:** `docs/superpowers/specs/2026-04-24-dev-docker-infra-design.md`

---

## File Structure

```
docker-compose.yml                         NEW (repo root)
.dockerignore                              NEW (repo root)
README.md                                  NEW (repo root quickstart)
scripts/
  dev.sh                                   NEW (chmod +x)
agents/
  Dockerfile                               NEW
  docker-entrypoint.sh                     NEW (chmod +x)
  README.md                                MODIFY (replace manual docker-run blocks)
  scripts/
    seed_dev.py                            NEW
```

No tests in a traditional sense — this is infra config. Verification is a manual smoke at the end (Task 8).

---

## Task 0: Remove old manually-started containers

**This is a prerequisite, not a file change. Destroys current DB data — spec acknowledged (fresh `pg-data` volume). Confirm no uncommitted data the user wants to keep.**

- [ ] **Step 1: Confirm with user if prompted, then stop + remove old containers**

Current docker state:
```bash
docker ps --format '{{.Names}}' | grep -E 'pgvector|pisang-rabbitmq'
```

If those show up, remove them:
```bash
docker rm -f pgvector pisang-rabbitmq
```

Expected: containers gone. `docker ps` no longer lists them.

- [ ] **Step 2: No commit for this task (infra action only)**

---

## Task 1: Root `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create `.dockerignore` at repo root**

```
**/__pycache__/
**/.venv/
**/node_modules/
**/.git/
**/.env
**/.pytest_cache/
**/dist/
**/build/
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "feat(docker): add root .dockerignore"
```

---

## Task 2: `agents/Dockerfile`

**Files:**
- Create: `agents/Dockerfile`

- [ ] **Step 1: Write the file**

```dockerfile
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl postgresql-client \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY agents/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY agents/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY agents/ /app/

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

- [ ] **Step 2: Verify file created**

```bash
ls -la agents/Dockerfile
```

Expected: file exists, ~700 bytes.

- [ ] **Step 3: Commit (deferred — combine with entrypoint in Task 3)**

Do not commit yet; entrypoint is a hard dependency.

---

## Task 3: `agents/docker-entrypoint.sh`

**Files:**
- Create: `agents/docker-entrypoint.sh`

- [ ] **Step 1: Write the file**

```bash
#!/usr/bin/env bash
set -e

wait_for_postgres() {
  until pg_isready -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-postgres}" >/dev/null 2>&1; do
    echo "[entrypoint] waiting for postgres..."
    sleep 1
  done
}

wait_for_rabbit() {
  until curl -fsS -u "${RABBITMQ_USER:-guest}:${RABBITMQ_PASS:-guest}" \
      "http://${RABBITMQ_HOST:-rabbitmq}:15672/api/overview" >/dev/null 2>&1; do
    echo "[entrypoint] waiting for rabbitmq..."
    sleep 1
  done
}

case "$SERVICE_ROLE" in
  init)
    wait_for_postgres
    echo "[init] alembic upgrade head"
    cd /app && alembic upgrade head
    echo "[init] prisma migrate deploy"
    cd /prisma && npx --yes prisma@latest migrate deploy --schema=/prisma/schema.prisma
    echo "[init] preload bge-m3"
    cd /app && python scripts/preload_embedder.py
    if [ "${SEED:-false}" = "true" ]; then
      echo "[init] seed"
      cd /app && python scripts/seed_dev.py
    fi
    echo "[init] done"
    ;;
  api)
    wait_for_postgres
    exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    ;;
  worker)
    wait_for_postgres
    wait_for_rabbit
    exec celery -A app.worker.celery_app worker -Q memory --loglevel=info --pool=threads --concurrency=2
    ;;
  beat)
    wait_for_rabbit
    exec celery -A app.worker.celery_app beat --loglevel=info
    ;;
  *)
    echo "unknown SERVICE_ROLE=$SERVICE_ROLE"
    exit 1
    ;;
esac
```

- [ ] **Step 2: Make executable**

```bash
chmod +x agents/docker-entrypoint.sh
```

- [ ] **Step 3: Verify shebang + exec bit**

```bash
head -1 agents/docker-entrypoint.sh
ls -l agents/docker-entrypoint.sh | cut -d' ' -f1
```

Expected: first line `#!/usr/bin/env bash`; permission string starts with `-rwx`.

- [ ] **Step 4: Commit Dockerfile + entrypoint together**

```bash
git add agents/Dockerfile agents/docker-entrypoint.sh
git commit -m "feat(docker): add agents Dockerfile + multi-role entrypoint"
```

---

## Task 4: `docker-compose.yml`

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write the file**

```yaml
name: pisang-dev

x-agents-env: &agents-env
  DATABASE_URL: postgresql://postgres:root@postgres:5432/pisangbisnes
  CELERY_BROKER_URL: amqp://guest:guest@rabbitmq:5672//
  EMBED_MODEL: BAAI/bge-m3
  MEMORY_ENABLED: "true"
  MEMORY_RECENT_TURNS: "20"
  MEMORY_SUMMARY_BATCH: "20"
  MEMORY_SUMMARY_INTERVAL_SEC: "3600"
  MEMORY_DISPLAY_TZ: Asia/Kuala_Lumpur
  APP_URL: http://host.docker.internal:3000
  POSTGRES_HOST: postgres
  POSTGRES_USER: postgres
  RABBITMQ_HOST: rabbitmq
  MODEL: ${MODEL:-}
  API_KEY: ${API_KEY:-}
  OPENAI_API_BASE: ${OPENAI_API_BASE:-}

x-agents-common: &agents-common
  extra_hosts:
    - "host.docker.internal:host-gateway"

services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: root
      POSTGRES_DB: pisangbisnes
    ports:
      - "5433:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d pisangbisnes"]
      interval: 2s
      timeout: 3s
      retries: 30

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 5s
      retries: 20

  agents-init:
    build:
      context: .
      dockerfile: agents/Dockerfile
    image: pisang-agents:dev
    profiles: ["init"]
    <<: *agents-common
    environment:
      <<: *agents-env
      SERVICE_ROLE: init
      SEED: ${SEED:-true}
    volumes:
      - ./agents:/app
      - ./app/prisma:/prisma:ro
      - hf-cache:/root/.cache/huggingface
    depends_on:
      postgres:
        condition: service_healthy

  agents-api:
    image: pisang-agents:dev
    build:
      context: .
      dockerfile: agents/Dockerfile
    <<: *agents-common
    environment:
      <<: *agents-env
      SERVICE_ROLE: api
    ports:
      - "8000:8000"
    volumes:
      - ./agents:/app
    depends_on:
      postgres:
        condition: service_healthy

  agents-worker:
    image: pisang-agents:dev
    build:
      context: .
      dockerfile: agents/Dockerfile
    <<: *agents-common
    environment:
      <<: *agents-env
      SERVICE_ROLE: worker
    volumes:
      - ./agents:/app
      - hf-cache:/root/.cache/huggingface
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  agents-beat:
    image: pisang-agents:dev
    build:
      context: .
      dockerfile: agents/Dockerfile
    <<: *agents-common
    environment:
      <<: *agents-env
      SERVICE_ROLE: beat
    volumes:
      - ./agents:/app
      - hf-cache:/root/.cache/huggingface
    depends_on:
      rabbitmq:
        condition: service_healthy

volumes:
  pg-data:
  hf-cache:
```

- [ ] **Step 2: Validate compose syntax**

```bash
docker compose config >/dev/null
```

Expected: no errors (silent). If YAML or reference errors appear, fix them inline.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add compose for postgres + rabbitmq + agents stack"
```

---

## Task 5: `scripts/dev.sh`

**Files:**
- Create: `scripts/dev.sh`

- [ ] **Step 1: Ensure `scripts/` exists**

```bash
mkdir -p scripts
```

- [ ] **Step 2: Write the file**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose"

cmd="${1:-help}"
shift || true

precheck_ports() {
  for c in pgvector pisang-rabbitmq; do
    if docker ps --format '{{.Names}}' | grep -qx "$c"; then
      echo "ERROR: old container '$c' is running on the ports compose needs."
      echo "       stop it first: docker rm -f $c"
      exit 1
    fi
  done
}

case "$cmd" in
  up)
    precheck_ports
    first_run=false
    if ! docker volume inspect pisang-dev_pg-data >/dev/null 2>&1; then
      first_run=true
    fi

    echo "==> building images"
    $COMPOSE build

    echo "==> starting infra"
    $COMPOSE up -d postgres rabbitmq

    if [ "$first_run" = "true" ] || [ "${1:-}" = "--init" ]; then
      echo "==> running init (migrations + preload + seed)"
      $COMPOSE --profile init run --rm agents-init
    fi

    echo "==> starting agents services"
    $COMPOSE up -d agents-api agents-worker agents-beat

    cat <<EOF

Stack ready:
  FastAPI         http://localhost:8000
  RabbitMQ admin  http://localhost:15672 (guest/guest)
  Postgres        localhost:5433 (postgres/root/pisangbisnes)

TS frontend: run 'pnpm dev' in app/
EOF
    ;;

  down)
    $COMPOSE down
    ;;

  reset)
    read -r -p "This destroys pg-data volume. Continue? [y/N] " ans
    [ "$ans" = "y" ] || exit 0
    $COMPOSE down -v
    "$0" up
    ;;

  init)
    $COMPOSE --profile init run --rm agents-init
    ;;

  seed)
    SEED=true $COMPOSE --profile init run --rm agents-init
    ;;

  logs)
    $COMPOSE logs -f "${@:-agents-api agents-worker}"
    ;;

  ps)
    $COMPOSE ps
    ;;

  shell)
    svc="${1:-agents-api}"
    $COMPOSE exec "$svc" /bin/bash
    ;;

  psql)
    $COMPOSE exec postgres psql -U postgres -d pisangbisnes
    ;;

  help|*)
    cat <<EOF
Usage: ./scripts/dev.sh <command>

  up              bring up full stack (auto-runs init on first run)
  up --init       force re-run init (migrations + preload + seed)
  down            stop all services (volumes preserved)
  reset           destroy volumes + restart from scratch
  init            run alembic + prisma migrate + preload bge-m3
  seed            same as init but force-seed demo data
  logs [svc...]   tail logs (default: api + worker)
  ps              show container status
  shell [svc]     bash into service (default: agents-api)
  psql            open psql inside postgres container
EOF
    ;;
esac
```

- [ ] **Step 3: Make executable**

```bash
chmod +x scripts/dev.sh
```

- [ ] **Step 4: Verify help renders**

```bash
./scripts/dev.sh help
```

Expected: the `Usage:` block prints.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev.sh
git commit -m "feat(scripts): add dev.sh wrapper for compose lifecycle"
```

---

## Task 6: `agents/scripts/seed_dev.py`

**Files:**
- Create: `agents/scripts/seed_dev.py`

- [ ] **Step 1: Write the file**

```python
"""Insert a demo user + business + products + KB doc for dev."""
import os
from sqlalchemy import create_engine, text


def main():
    eng = create_engine(os.environ["DATABASE_URL"])
    with eng.begin() as c:
        c.execute(text("""
            INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
            VALUES ('dev-user', 'Dev User', 'dev@example.com', false, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))
        c.execute(text("""
            INSERT INTO business (id, name, code, mission, "userId", "createdAt", "updatedAt")
            VALUES ('dev-biz', 'Pisang Demo', 'DEMO-001', 'Jual pisang segar', 'dev-user', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))
        c.execute(text("""
            INSERT INTO product (id, name, price, stock, description, "businessId", "createdAt", "updatedAt")
            VALUES
              ('prod-hijau', 'Pisang Hijau', 1.00, 50, 'Sihat, keras', 'dev-biz', NOW(), NOW()),
              ('prod-masak', 'Pisang Masak', 1.50, 30, 'Manis, lembut', 'dev-biz', NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """))
    print("[seed] dev data ready: user=dev-user, business=dev-biz, 2 products")

    from app.worker.tasks import embed_kb_chunk
    embed_kb_chunk.delay(
        business_id="dev-biz",
        source_id="shipping-policy",
        chunk_index=0,
        content="We ship KL same day before 2pm. Outside KL takes 2-3 days via Poslaju.",
    )
    print("[seed] KB enqueued for embedding")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add agents/scripts/seed_dev.py
git commit -m "feat(seed): add dev seed script for demo business + products + KB"
```

---

## Task 7: First-run smoke

**No file changes. This is the verification gate. If anything fails, debug before proceeding to docs tasks.**

- [ ] **Step 1: Build + start**

```bash
./scripts/dev.sh up
```

Expected flow:
1. `==> building images` (3–5 min first time)
2. `==> starting infra` → postgres + rabbitmq reach healthy
3. `==> running init (migrations + preload + seed)` — alembic, prisma migrate, bge-m3 download (~2 min), seed
4. `==> starting agents services` → api + worker + beat start
5. "Stack ready:" banner

If init fails on Prisma migrate, check that `/prisma/schema.prisma` is mounted read-only and that the schema does not require `prisma generate` to succeed (if it does, prepend `npx prisma generate --schema=/prisma/schema.prisma` to the entrypoint init block).

- [ ] **Step 2: Verify all containers are running**

```bash
./scripts/dev.sh ps
```

Expected: `postgres`, `rabbitmq`, `agents-api`, `agents-worker`, `agents-beat` all `running`. (Init container already exited — normal.)

- [ ] **Step 3: Health check**

```bash
curl -s http://localhost:8000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Smoke chat**

Requires `MODEL`, `API_KEY`, `OPENAI_API_BASE` exported on host (or in a `.env` file if compose is configured to read it — by default it reads `MODEL: ${MODEL:-}` from the shell that invokes `dev.sh`). If creds are missing, this step will 500; in that case export the creds, `./scripts/dev.sh down`, re-`up`, and retry.

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

Expected: `"status": "sent"` or `"pending_approval"` with a non-empty reply.

- [ ] **Step 5: Verify memory write landed**

Wait ~3 seconds for Celery worker to process, then:

```bash
./scripts/dev.sh psql -c 'SELECT COUNT(*) FROM memory_conversation_turn;'
```

Expected: count ≥ 1.

- [ ] **Step 6: Verify KB seed landed**

```bash
./scripts/dev.sh psql -c 'SELECT "sourceId", LEFT(content, 40) FROM memory_kb_chunk;'
```

Expected: one row with `sourceId=shipping-policy`.

- [ ] **Step 7: No commit for this task (verification only)**

If all 6 checks pass, proceed to Task 8. If any fail, stop and debug — do not continue to docs tasks until the smoke is green.

---

## Task 8: Update `agents/README.md`

**Files:**
- Modify: `agents/README.md`

- [ ] **Step 1: Read current file**

```bash
cat agents/README.md | head -80
```

You need to know the existing structure before editing.

- [ ] **Step 2: Replace manual setup blocks with compose instructions**

Remove the existing "Memory setup (pgvector + RabbitMQ)" and "Running with memory enabled" sections and replace them with a single "Running with docker" section. Do NOT delete the "Structure" or "Setup" sections that describe the code layout — keep those intact.

New section (insert near the top of the file, after any existing Structure section):

```markdown
## Running with docker (recommended)

All infra (Postgres + pgvector, RabbitMQ) and all agent services (FastAPI, Celery worker, Celery beat) run under docker compose. See the repo root README for the full quickstart. Short form:

```bash
# from the repo root
./scripts/dev.sh up          # first run: builds + seeds
./scripts/dev.sh logs        # tail api + worker
./scripts/dev.sh psql        # shell into the DB
./scripts/dev.sh reset       # wipe volumes + re-seed
```

## Running on host (without docker)

Only needed if you prefer native processes (faster Python iteration at the cost of manual setup).

Prereqs:
- Postgres with `pgvector` extension (run `psql -c "CREATE EXTENSION vector"` once as superuser)
- RabbitMQ on `localhost:5672`
- `DATABASE_URL` exported in a `.env` file next to this README

Three processes:

```bash
uvicorn main:app --reload                                                 # terminal 1
celery -A app.worker.celery_app worker -Q memory --loglevel=info --pool=threads --concurrency=2   # terminal 2
celery -A app.worker.celery_app beat --loglevel=info                       # terminal 3
```

Smoke:

```bash
python scripts/smoke_memory.py
```
```

- [ ] **Step 3: Commit**

```bash
git add agents/README.md
git commit -m "docs(agents): replace manual setup with docker compose instructions"
```

---

## Task 9: Root `README.md`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Check if root README already exists**

```bash
ls README.md 2>/dev/null && head -20 README.md
```

If one exists, integrate new content into it rather than overwriting. If it does not exist, create fresh.

- [ ] **Step 2: Write the file**

```markdown
# Pisang Biru — UM Hackathon 2026

Agentic commerce assistant for small Malaysian sellers. Monorepo with two deployable units:

- `agents/` — FastAPI + LangGraph customer-support agent with pgvector-backed memory. Python 3.13, Celery worker + beat, RabbitMQ broker.
- `app/` — TanStack Start frontend with Prisma, Better Auth, tRPC.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- Node 20+ and `pnpm`
- LLM credentials (OpenAI-compatible endpoint): `MODEL`, `API_KEY`, `OPENAI_API_BASE`

Export the LLM creds in your shell (or put them in a host-level dotenv the compose runtime sees):

```bash
export MODEL=gpt-4o-mini
export API_KEY=sk-...
export OPENAI_API_BASE=https://api.openai.com/v1
```

## Quickstart

```bash
git clone <repo-url>
cd umhackathon2026

# backend (Postgres + pgvector, RabbitMQ, FastAPI, Celery worker + beat)
./scripts/dev.sh up

# in another terminal: TS frontend (stays on host for fast HMR)
cd app
pnpm install
pnpm dev
```

First run takes ~5 minutes: it builds the agents image (3 min), downloads `BAAI/bge-m3` (~2 GB, 1–2 min), runs alembic + prisma migrations, and seeds a demo business.

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

**Prisma migrate fails in init** — run `cd app && pnpm prisma generate` on the host, commit the generated client if needed, then `./scripts/dev.sh reset`.

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

## Docs

Design specs and implementation plans live in `docs/superpowers/`. Start with:

- `docs/superpowers/specs/2026-04-24-pgvector-agent-memory-design.md` — memory architecture
- `docs/superpowers/specs/2026-04-24-dev-docker-infra-design.md` — this infra
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add repo-root README with docker quickstart"
```

---

## Task 10: Final end-to-end verification

**No file changes. Final gate before calling the plan complete.**

- [ ] **Step 1: Clean reset**

```bash
./scripts/dev.sh reset
```

Answer `y` at the prompt. Expect full teardown + fresh rebuild.

- [ ] **Step 2: Cold-start smoke**

Re-run Task 7 steps 1–6 from scratch. All should still pass.

- [ ] **Step 3: Restart preserves data**

```bash
./scripts/dev.sh down
./scripts/dev.sh up
./scripts/dev.sh psql -c 'SELECT COUNT(*) FROM memory_conversation_turn;'
```

Expected: count is the same as before `down` (data survived the restart; init did NOT re-run).

- [ ] **Step 4: Re-seed idempotency**

```bash
./scripts/dev.sh seed
./scripts/dev.sh psql -c "SELECT COUNT(*) FROM business WHERE id='dev-biz';"
./scripts/dev.sh psql -c "SELECT COUNT(*) FROM product WHERE \"businessId\"='dev-biz';"
```

Expected: business count = 1, product count = 2. No duplicates.

- [ ] **Step 5: Hot-reload sanity**

Edit `agents/app/memory/formatter.py` — change `"Use this history to maintain continuity."` to `"USE THIS HISTORY."` and save. Watch `./scripts/dev.sh logs agents-api` — you should see `WatchFiles detected changes ... Reloading`. Revert the edit afterwards.

- [ ] **Step 6: Host TS frontend connects**

```bash
cd app
pnpm dev
```

Open `http://localhost:3000`. The frontend should load and Prisma queries against `localhost:5433` should succeed.

- [ ] **Step 7: Tear down**

```bash
./scripts/dev.sh down
```

- [ ] **Step 8: No commit (verification only)**

---

## Done

All infra committed on `atan` branch. Dev workflow is now:

```bash
./scripts/dev.sh up             # start backend
cd app && pnpm dev              # start frontend
```

Rollback (if ever needed): `docker compose down -v && git revert <commits>`.
