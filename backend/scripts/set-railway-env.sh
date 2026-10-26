#!/usr/bin/env bash
# Pushes the local backend/.env values to the linked Railway service.
# Run this yourself so secrets never pass through an agent log.
#
# Usage (from backend/, after `railway login` and linking the service):
#   VERCEL_URL='https://your-preview.vercel.app' bash scripts/set-railway-env.sh
#
# DATABASE_URL is NOT copied from .env: it is set to Railway's Postgres
# reference variable instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERCEL_URL="${VERCEL_URL:-}"

if [ -z "$VERCEL_URL" ]; then
  echo "Usage: VERCEL_URL='https://your-preview.vercel.app' bash scripts/set-railway-env.sh" >&2
  exit 1
fi

if [ ! -f "$ROOT/.env" ]; then
  echo "Missing $ROOT/.env" >&2
  exit 1
fi

# Read values without executing .env: unquoted names with spaces would break
# `source` (e.g. MAIL_FROM_NAME=MATE ZONE CHESS ACADEMY).
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

if command -v railway >/dev/null 2>&1; then
  RW=(railway)
else
  RW=(npx --yes @railway/cli)
fi

set_var() {
  local key="$1" value="$2"
  printf '%s' "$value" | "${RW[@]}" variable set "$key" --stdin --skip-deploys >/dev/null
  echo "  set $key"
}

echo "Setting Railway variables on the linked service..."

set_var DATABASE_URL '${{Postgres.DATABASE_URL}}'
set_var NODE_ENV production
set_var CLIENT_URL "$VERCEL_URL"
set_var FRONTEND_URL "$VERCEL_URL"

for key in \
  JWT_SECRET JWT_EXPIRES_IN \
  GAME_HISTORY_RETENTION_DAYS GAME_HISTORY_RUN_INTERVAL_MS \
  LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET \
  MAIL_HOST MAIL_PORT MAIL_USER MAIL_PASS MAIL_FROM MAIL_FROM_NAME \
  MAIL_SECURE MAIL_TRANSPORT
do
  value="$(env_get "$key")"
  if [ -n "$value" ]; then
    set_var "$key" "$value"
  fi
done

echo "Done. Redeploy the service to apply the new variables."
