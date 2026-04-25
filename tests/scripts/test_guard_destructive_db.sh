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
