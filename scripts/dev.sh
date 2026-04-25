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
    $COMPOSE --profile init build

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

  agents-migrate)
    $COMPOSE --profile init run --rm --entrypoint "" -w /app agents-init alembic upgrade head
    ;;

  seed)
    SEED=true $COMPOSE --profile init run --rm agents-init
    ;;

  env)
    echo "==> reloading agents services with fresh agents/.env"
    $COMPOSE restart agents-api agents-worker agents-beat
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
  agents-migrate  run alembic upgrade head only (agents schema)
  seed            same as init but force-seed demo data
  env             reload agents services after editing agents/.env
  logs [svc...]   tail logs (default: api + worker)
  ps              show container status
  shell [svc]     bash into service (default: agents-api)
  psql            open psql inside postgres container
EOF
    ;;
esac
