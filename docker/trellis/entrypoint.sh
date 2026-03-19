#!/bin/sh
set -e

DATA_ROOT="${TRELLIS_DATA_ROOT:-/data}"
mkdir -p "${DATA_ROOT}/input" "${DATA_ROOT}/output" "${DATA_ROOT}/cache"

cd /opt/trellis-bridge
exec uvicorn server:app --host 0.0.0.0 --port "${TRELLIS_PORT:-8080}"
