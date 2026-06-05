#!/bin/sh
set -eu

if [ "${INSTRUCTION_MONITOR_SEED_CORE_ON_START:-false}" = "true" ]; then
  seed_path="${INSTRUCTION_MONITOR_SEED_CORE_PATH:-/app/seeds/pgvector/core.json}"
  echo "Importing instruction-monitor core seed from ${seed_path}"
  node /app/services/gateway/dist/services/instruction-monitor/seed-core.js "${seed_path}"
fi

exec "$@"
