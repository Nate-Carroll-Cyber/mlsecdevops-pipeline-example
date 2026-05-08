#!/bin/sh
set -eu

mkdir -p /app/backend/data
chown -R node:node /app/backend/data

exec su-exec node "$@"
