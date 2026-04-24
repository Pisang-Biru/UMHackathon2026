# Dev Docker Infrastructure — Design

**Date:** 2026-04-24
**Status:** Approved, pending implementation plan

## Goal

One-command dev setup for the whole backend stack (Postgres + pgvector, RabbitMQ, FastAPI agent, Celery worker, Celery beat). New contributors clone the repo, run `./scripts/dev.sh up`, and land on a working system with seeded demo data. The TypeScript frontend continues to run on the host via `pnpm dev` (bind-mounting vite into Docker on macOS cripples HMR).

## Stack decisions

| Decision | Choice | Reason |
|---|---|---|
| Scope | Infra + agents services in compose; TS stays on host | macOS vite-in-docker slow; Python hot reload works fine |
| Migrations/seed | One-shot `init` service under `profiles: ["init"]` | Explicit, clean separation from long-running services |
| Hot reload | Bind-mount source, `uvicorn --reload` + threaded Celery | Instant feedback for Python edits |
| bge-m3 cache | Named docker volume `hf-cache` | Survives restarts; no host coupling |
| Postgres data | Named volume `pg-data` (fresh) | Seed via `init`, no legacy-data migration |
| Wrapper | `scripts/dev.sh` bash | Handles first-run detection, reset, pre-checks |

## Architecture

**Services (`docker-compose.yml`):**

| Service | Image | Ports | Role |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg17` | `5433:5432` | DB + pgvector extension |
| `rabbitmq` | `rabbitmq:3-management` | `5672:5672`, `15672:15672` | Celery broker |
| `agents-init` | `pisang-agents:dev` (profile `init`) | — | Runs alembic + prisma + preload + seed, exits |
| `agents-api` | `pisang-agents:dev` | `8000:8000` | FastAPI `uvicorn --reload` |
| `agents-worker` | `pisang-agents:dev` | — | `celery worker --pool=threads --concurrency=2` |
| `agents-beat` | `pisang-agents:dev` | — | `celery beat` |

**Volumes:** `pg-data`, `hf-cache`

**Bind mounts:** `./agents:/app` (hot reload), `./app/prisma:/prisma:ro` (for Prisma migrate in init)

## File layout

```
docker-compose.yml                         NEW (repo root)
.dockerignore                              NEW (repo root)
README.md                                  MODIFY (root-level quickstart)
scripts/
  dev.sh                                   NEW
agents/
  Dockerfile                               NEW
  docker-entrypoint.sh                     NEW
  README.md                                MODIFY (remove manual docker run blocks)
  scripts/
    seed_dev.py                            NEW
```

## `agents/Dockerfile` (multi-role via entrypoint)

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

Single image for api/worker/beat/init. Role selected at runtime via `$SERVICE_ROLE`.

## `agents/docker-entrypoint.sh`

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

## `docker-compose.yml`

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

Notes:
- `agents-init` gated by `profiles: ["init"]` — only runs when invoked explicitly
- All 4 agents services share the same built image `pisang-agents:dev`
- LLM creds (`MODEL`, `API_KEY`, `OPENAI_API_BASE`) read from host env; empty defaults are acceptable (chat will fail with a clear error if missing)
- `APP_URL` points to `host.docker.internal:3000` so the TS frontend running on the host receives `/pay/{orderId}` URLs
- Postgres mapped to host port 5433 (unchanged) so host-side `psql` keeps working

## `scripts/dev.sh`

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

## `agents/scripts/seed_dev.py`

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

Idempotent via `ON CONFLICT DO NOTHING`. Safe to re-run.

## `.dockerignore`

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

## Error handling

| Failure | Behavior |
|---|---|
| Port 5433 or 5672 already bound by a non-compose container | `dev.sh up` pre-check fails with clear message and `docker rm -f` hint |
| `alembic upgrade head` fails in init | Init exits non-zero, `up` aborts, logs visible |
| `prisma migrate deploy` fails | Same — visible failure, user must fix schema |
| bge-m3 download stalls | HF cache volume allows resume on retry; no enforced timeout |
| Celery fork crashes on macOS | `--pool=threads` in entrypoint avoids fork |
| Host has stale `pgvector` or `pisang-rabbitmq` containers from earlier manual `docker run` | Pre-check catches this; user removes them |
| LLM creds missing | API starts, chat endpoint returns 500; message surfaces in logs (acceptable, same as current) |
| Linux host without `host.docker.internal` | `extra_hosts: host-gateway` mapping fixes it |

## Migration plan (sequenced)

1. **Stop old containers** — `docker rm -f pgvector pisang-rabbitmq`. Data loss expected (fresh `pg-data` volume). Code on `atan` already pushed.
2. **Create `.dockerignore`** at repo root.
3. **Create `agents/Dockerfile`** + `agents/docker-entrypoint.sh` (`chmod +x`).
4. **Create `docker-compose.yml`** at repo root.
5. **Create `scripts/dev.sh`** (`chmod +x`).
6. **Create `agents/scripts/seed_dev.py`**.
7. **First run** — `./scripts/dev.sh up`. Expect: build ~3 min, init ~2 min (bge-m3 download), then all 3 agents services running.
8. **Smoke** — `curl http://localhost:8000/health` returns `{"status":"ok"}`. POST a chat with `business_id=dev-biz`, `customer_phone=+60123456789`, msg "nak beli 2 pisang hijau".
9. **Verify** — `./scripts/dev.sh psql` → `SELECT COUNT(*) FROM memory_conversation_turn;` ≥ 1.
10. **Update `agents/README.md`** — replace manual setup with `./scripts/dev.sh up`. Keep "without docker" appendix for host-venv users.
11. **Write `README.md` at repo root** — top-level quickstart: prereqs, clone, `./scripts/dev.sh up`, `cd app && pnpm dev`, smoke test instructions, troubleshooting common issues (port conflicts, first-run slowness, LLM creds).
12. **Commit all** on `atan` branch.

## Rollback

`docker compose down -v` wipes volumes. Remove all new files. Original host-venv workflow still works.

## Testing

- **Cold start**: `./scripts/dev.sh reset && ./scripts/dev.sh up` → smoke chat succeeds end-to-end.
- **Restart**: `./scripts/dev.sh down && ./scripts/dev.sh up` → containers come back, data preserved, no re-init.
- **Re-seed idempotency**: `./scripts/dev.sh seed` twice — no duplicate-key errors, no extra rows.
- **Hot reload**: edit `agents/app/memory/formatter.py`, save → api auto-reloads. (Celery worker does NOT hot-reload; documented.)
- **TS host integration**: `cd app && pnpm dev` still connects to `localhost:5433` → Prisma queries work.

No automated tests for compose itself; verified manually via the above checklist.

## Non-goals

- Production deployment (single-node dev only)
- CI integration (no compose-based CI yet)
- Secrets vault (plain env for dev)
- Resource limits / quotas
- Compose for TS frontend (stays on host for HMR speed)
- Auto-watching Celery worker source changes (use `./scripts/dev.sh restart agents-worker` manually when task code changes)
