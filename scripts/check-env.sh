#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/srv/tenaCierge"

# Load environment variables for verification without leaking secrets
set -a
source "$BASE_DIR/.env"
set +a

cd "$BASE_DIR"
node -e "console.log({ DB_HOST: process.env.DB_HOST, DB_USER: process.env.DB_USER, DB_NAME: process.env.DB_NAME, VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY })"
