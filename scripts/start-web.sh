#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/srv/tenaCierge"
LOG_DIR="$BASE_DIR/logs"

# Export all env vars defined in .env for the child process
set -a
source "$BASE_DIR/.env"
set +a

mkdir -p "$LOG_DIR"
cd "$BASE_DIR"

nohup bun run start -H 0.0.0.0 > "$LOG_DIR/webserver.log" 2>&1 &
echo "Started web server with .env exported; logs: $LOG_DIR/webserver.log"
