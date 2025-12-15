#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${PUSH_WORKER_BASE_URL:-"http://localhost:3200"}
BATCH_SIZE=${PUSH_WORKER_BATCH_SIZE:-50}
LOCKED_BY=${PUSH_WORKER_ID:-"webpush-cron"}
TOKEN=${PUSH_WORKER_TOKEN:-""}
TOKEN_HEADER=${PUSH_WORKER_TOKEN_HEADER:-"x-worker-token"}

body=$(cat <<JSON
{
  "limit": ${BATCH_SIZE},
  "lockedBy": "${LOCKED_BY}"
}
JSON
)

args=(
  -sS
  -X POST
  "${BASE_URL%/}/api/push/worker"
  -H "Content-Type: application/json"
  -d "${body}"
)

if [[ -n "${TOKEN}" ]]; then
  args+=( -H "${TOKEN_HEADER}: ${TOKEN}" )
fi

curl "${args[@]}"
