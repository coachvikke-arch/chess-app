#!/usr/bin/env bash
# Internal helper: run under `railway run --service Postgres` so Railway
# injects PG* and RAILWAY_TCP_PROXY_* variables.
set -euo pipefail

TARGET_DATABASE_URL=$(node -e "
  const p = encodeURIComponent(process.env.PGPASSWORD || '');
  console.log('postgresql://' + process.env.PGUSER + ':' + p + '@' +
    process.env.RAILWAY_TCP_PROXY_DOMAIN + ':' +
    process.env.RAILWAY_TCP_PROXY_PORT + '/' +
    process.env.PGDATABASE + '?sslmode=require');
")
export TARGET_DATABASE_URL

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/migrate-db-to-cloud.sh"
