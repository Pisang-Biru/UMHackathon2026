#!/usr/bin/env bash
# PreToolUse hook for Bash tool calls.
# Reads the Claude Code tool-call JSON from stdin, regex-matches the `command`
# field against a blocklist of destructive DB operations, and exits 2 (block)
# with a reason if any pattern hits.

set -uo pipefail

payload=$(cat)
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
else
  cmd=$(printf '%s' "$payload" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("tool_input") or {}).get("command",""))' 2>/dev/null || echo "")
fi

block() {
  local pattern=$1 reason=$2
  cat >&2 <<EOF
[guard-destructive-db] BLOCKED: $reason
  matched pattern: $pattern
  command:         $cmd

This repo uses dual migrators (Prisma owns public.*, Alembic owns agents.*).
See CLAUDE.md "Database safety" + docs/superpowers/specs/2026-04-25-schema-isolation-and-db-safety-design.md.

To proceed: ask the user explicitly, or add a permissions.allow entry to
.claude/settings.local.json after they confirm.
EOF
  exit 2
}

[ -z "$cmd" ] && exit 0

match() { printf '%s' "$cmd" | grep -Eqi "$1"; }

match 'prisma[[:space:]]+db[[:space:]]+push'                                  && block 'prisma db push'                  '`prisma db push` bypasses migration history and can drop alembic-owned tables.'
match 'prisma[[:space:]]+migrate[[:space:]]+reset'                            && block 'prisma migrate reset'            '`migrate reset` drops the dev DB.'
match 'prisma[[:space:]]+migrate[[:space:]]+dev.*--accept-data-loss'          && block 'prisma migrate dev --accept-data-loss' 'Destructive Prisma migrate flag.'
match '\b(drop|truncate)[[:space:]]+(table|schema|database)\b'                && block 'DROP/TRUNCATE TABLE/SCHEMA/DATABASE' 'Destructive DDL.'
match '(docker[[:space:]]+(compose[[:space:]]+)?exec[^|;&]*)?psql[^|;&]*-c[^|;&]*\b(drop|truncate|delete|update)\b' \
                                                                              && block 'psql -c <write>'                 'Inline psql write/DDL.'

exit 0
