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
    echo "[init] prisma migrate deploy"
    cd /app-ts && npx --yes prisma@latest migrate deploy
    echo "[init] alembic upgrade head"
    cd /app && alembic upgrade head
    echo "[init] preload bge-m3"
    cd /app && python scripts/preload_embedder.py
    if [ "${SEED:-false}" = "true" ]; then
      echo "[init] seed"
      cd /app && PYTHONPATH=/app python scripts/seed_dev.py
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
