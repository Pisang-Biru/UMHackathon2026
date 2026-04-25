#!/usr/bin/env bash
# Apply the agents-schema-isolation migration on a teammate's existing dev DB.
#
# What it does (in order):
#   1. preflight   — confirm postgres is reachable and on the expected layout
#   2. snapshot    — record row counts of soon-to-be-moved tables, BEFORE
#   3. bootstrap   — relocate alembic_version into agents schema so env.py finds it
#   4. migrate     — run `alembic upgrade head` inside agents-api (applies 0005)
#   5. verify      — confirm tables now live under `agents.*`, not `public.*`
#   6. restart     — restart agents-api + worker + beat to pick up env.py change
#   7. recount     — re-snapshot row counts AFTER, diff against BEFORE
#   8. registry    — re-trigger upsert_registry() so business_agents repopulates
#
# Safe to re-run. ALTER TABLE ... SET SCHEMA preserves data, indexes, FKs.
# If `alembic_version` already shows 0005 applied, the migration is a no-op.

set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose"
DB_USER=postgres
DB_NAME=pisangbisnes
PG_SVC=postgres
API_SVC=agents-api

# Tables that migration 0005 moves from public.* to agents.*
MOVED_TABLES=(
  memory_conversation_summary
  memory_conversation_turn
  memory_kb_chunk
  memory_past_action
  memory_product_embedding
  agent_events
  agents
  business_agents
  alembic_version
)

step() { printf "\n==> %s\n" "$1"; }
ok()   { printf "    \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "    \033[33m!\033[0m %s\n" "$1"; }
die()  { printf "    \033[31m✗\033[0m %s\n" "$1" >&2; exit 1; }

psql_q() {
  $COMPOSE exec -T "$PG_SVC" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1"
}

table_count() {
  # $1 = schema, $2 = table. Returns "-" if table missing in that schema.
  local schema=$1 table=$2
  local exists
  exists=$(psql_q "SELECT 1 FROM information_schema.tables WHERE table_schema='$schema' AND table_name='$table' LIMIT 1;" || true)
  if [ -z "$exists" ]; then
    echo "-"
  else
    psql_q "SELECT count(*) FROM \"$schema\".\"$table\";"
  fi
}

# ------------------------------------------------------------------
step "preflight: docker compose + postgres reachable"
$COMPOSE ps "$PG_SVC" >/dev/null 2>&1 || die "$PG_SVC not running. Run: ./scripts/dev.sh up"
psql_q "SELECT 1;" >/dev/null || die "cannot psql into $PG_SVC"
ok "$PG_SVC reachable"

agents_schema_present=$(psql_q "SELECT 1 FROM information_schema.schemata WHERE schema_name='agents';" || true)
if [ -n "$agents_schema_present" ]; then
  warn "agents schema already exists — script will be a no-op for tables already moved"
fi

# ------------------------------------------------------------------
step "snapshot: row counts BEFORE migration"
declare -A before
for t in "${MOVED_TABLES[@]}"; do
  pub=$(table_count public "$t")
  agt=$(table_count agents "$t")
  printf "    %-32s public=%-6s agents=%-6s\n" "$t" "$pub" "$agt"
  # Source-of-truth: whichever schema currently has the table.
  if [ "$pub" != "-" ]; then before[$t]=$pub; else before[$t]=$agt; fi
done

# ------------------------------------------------------------------
# Bootstrap: env.py now points alembic at agents.alembic_version. On a pre-0005
# DB, the version table still lives in public.alembic_version, so alembic would
# otherwise see "no version" and try to replay every migration from base —
# colliding with already-existing public tables. Relocate the version table
# (and any sequence) up front so alembic finds revision 0004 and applies 0005.
step "bootstrap: move alembic_version into agents schema if needed"
$COMPOSE exec -T "$PG_SVC" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE SCHEMA IF NOT EXISTS agents;
DO $$
DECLARE
  has_public_ver  boolean;
  has_agents_ver  boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='alembic_version')
    INTO has_public_ver;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='agents' AND table_name='alembic_version')
    INTO has_agents_ver;

  IF has_public_ver AND NOT has_agents_ver THEN
    EXECUTE 'ALTER TABLE public.alembic_version SET SCHEMA agents';
    RAISE NOTICE 'moved public.alembic_version -> agents.alembic_version';
  ELSIF has_public_ver AND has_agents_ver THEN
    RAISE NOTICE 'alembic_version exists in both schemas — leaving public copy in place; migration 0005 will reconcile';
  ELSIF has_agents_ver THEN
    RAISE NOTICE 'agents.alembic_version already present — no bootstrap needed';
  ELSE
    RAISE NOTICE 'no alembic_version table found — fresh DB, alembic will create one in agents schema';
  END IF;
END
$$;
SQL
ok "alembic_version reachable from agents schema"

# ------------------------------------------------------------------
step "migrate: alembic upgrade head (applies 0005_isolate_agents_schema)"
$COMPOSE exec -T "$API_SVC" alembic upgrade head || die "alembic upgrade failed — see error above. Do NOT run prisma db push."
ok "alembic upgrade complete"

# ------------------------------------------------------------------
step "verify: every moved table now lives under agents.*"
missing=()
for t in "${MOVED_TABLES[@]}"; do
  agt=$(table_count agents "$t")
  pub=$(table_count public "$t")
  if [ "$agt" = "-" ]; then
    missing+=("$t")
    printf "    \033[31m✗\033[0m %-32s NOT FOUND in agents.*\n" "$t"
  elif [ "$pub" != "-" ]; then
    warn "$t exists in BOTH public and agents — investigate manually"
  else
    printf "    \033[32m✓\033[0m %-32s agents.%s (%s rows)\n" "$t" "$t" "$agt"
  fi
done
[ ${#missing[@]} -eq 0 ] || die "tables missing from agents.*: ${missing[*]}"

# ------------------------------------------------------------------
step "restart: agents-api + worker + beat (pick up env.py / model schema)"
$COMPOSE restart "$API_SVC" agents-worker agents-beat >/dev/null
ok "services restarted"

# Give uvicorn a moment to come back up before we exec into it.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if $COMPOSE exec -T "$API_SVC" python -c "import app.db" >/dev/null 2>&1; then
    ok "$API_SVC ready"
    break
  fi
  [ "$i" = 10 ] && die "$API_SVC did not come back up in 10s"
  sleep 1
done

# ------------------------------------------------------------------
step "recount: row counts AFTER migration (must match BEFORE)"
diffs=0
for t in "${MOVED_TABLES[@]}"; do
  agt=$(table_count agents "$t")
  if [ "${before[$t]}" = "$agt" ]; then
    printf "    \033[32m✓\033[0m %-32s %s rows preserved\n" "$t" "$agt"
  else
    printf "    \033[31m✗\033[0m %-32s before=%s after=%s — DATA LOSS\n" "$t" "${before[$t]}" "$agt"
    diffs=$((diffs+1))
  fi
done
[ "$diffs" = 0 ] || die "$diffs table(s) lost rows — investigate immediately"

# ------------------------------------------------------------------
step "registry: re-run upsert_registry() so business_agents stays current"
$COMPOSE exec -T "$API_SVC" python -c "from app.agents.registry import upsert_registry; upsert_registry()" >/dev/null
agent_rows=$(table_count agents agents)
ba_rows=$(table_count agents business_agents)
ok "agents.agents=$agent_rows rows, agents.business_agents=$ba_rows rows"

# ------------------------------------------------------------------
echo
ok "schema isolation applied. Prisma now owns public.*, alembic owns agents.*"
echo
cat <<'EOF'
Next:
  - smoke-test:  curl -s -X POST http://localhost:8000/agent/support/chat \
                   -H 'Content-Type: application/json' \
                   -d '{"business_id":"<your_biz>","customer_id":"x","customer_phone":"+60000","message":"ping"}'
  - if anything looks off, do NOT run `prisma db push`. Ping the channel.
EOF
