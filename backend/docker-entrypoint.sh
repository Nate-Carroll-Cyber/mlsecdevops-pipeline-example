#!/bin/sh
set -eu

mkdir -p /app/backend/data
chown -R node:node /app/backend/data

if [ "${INSTRUCTION_MONITOR_SEED_CORE_ON_START:-false}" = "true" ]; then
  seed_path="${INSTRUCTION_MONITOR_SEED_CORE_PATH:-/app/seeds/pgvector/core.json}"
  echo "Importing instruction-monitor core seed from ${seed_path}"
  su-exec node node /app/backend/dist/services/instruction-monitor/seed-core.js "${seed_path}"
fi

exec su-exec node "$@"
