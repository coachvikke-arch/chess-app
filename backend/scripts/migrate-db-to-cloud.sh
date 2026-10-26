#!/usr/bin/env bash
# Copies the local chess-academy schema + rows to a managed Postgres.
#
# Usage (from backend/):
#   TARGET_DATABASE_URL='postgresql://user:pass@host:port/db' \
#     bash scripts/migrate-db-to-cloud.sh
#
# The local credentials are read from backend/.env. Keep the target URL in
# your shell history-free environment or paste it when prompted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  echo "Missing $ROOT/.env" >&2
  exit 1
fi

trap 'rm -f "${DUMP_FILE:-}"' EXIT

# Read values without executing .env: some entries are unquoted names with
# spaces (MAIL_FROM_NAME=MATE ZONE ...) and break `source`.
env_get() {
  local key="$1" line value
  line="$(grep -m1 -E "^${key}=" "$ROOT/.env" || true)"
  [ -z "$line" ] && return 0
  value="${line#*=}"
  value="${value%$'\r'}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

SOURCE_URL="${SOURCE_DATABASE_URL:-$(env_get DATABASE_URL)}"
if [ -z "$SOURCE_URL" ]; then
  SOURCE_URL="postgresql://$(env_get DB_USER):$(env_get DB_PASSWORD)@$(env_get DB_HOST):$(env_get DB_PORT)/$(env_get DB_NAME)"
fi

if [ -z "${TARGET_DATABASE_URL:-}" ]; then
  printf 'Target Postgres URL: '
  read -r TARGET_DATABASE_URL
fi

if [ -z "$TARGET_DATABASE_URL" ]; then
  echo "TARGET_DATABASE_URL is required." >&2
  exit 1
fi

PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
PG_DUMP="$PG_BIN/pg_dump.exe"
PSQL="$PG_BIN/psql.exe"
[ -x "$PG_DUMP" ] || PG_DUMP="$(command -v pg_dump)"
[ -x "$PSQL" ] || PSQL="$(command -v psql)"

DUMP_FILE="$(mktemp -t chess-academy.XXXXXX.sql)"

echo "Dumping local database..."
"$PG_DUMP" "$SOURCE_URL" \
  --format=plain \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --no-comments > "$DUMP_FILE"

echo "Restoring into managed database..."
# transaction_timeout exists in PostgreSQL 17+; strip it when restoring to 16.
sed -e '/^SET transaction_timeout/d' "$DUMP_FILE" \
  | "$PSQL" "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -q

echo "Done. Local schema and data copied to the managed database."
