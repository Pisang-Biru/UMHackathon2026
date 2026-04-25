#!/usr/bin/env bash
set -euo pipefail

file="agents/docker-entrypoint.sh"

if LC_ALL=C grep -n "$(printf '\r')" "$file" >/dev/null; then
  echo "FAIL: $file contains CRLF line endings"
  exit 1
fi

echo "PASS: $file uses LF line endings"
