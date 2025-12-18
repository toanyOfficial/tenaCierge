#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/srv/tenaCierge"

# Load environment variables for verification without leaking secrets
set -a
source "$BASE_DIR/.env"
set +a

cd "$BASE_DIR"
node -e "console.log({ DB_HOST: process.env.DB_HOST, DB_USER: process.env.DB_USER, DB_NAME: process.env.DB_NAME, GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS, NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID, NEXT_PUBLIC_FCM_VAPID_KEY: process.env.NEXT_PUBLIC_FCM_VAPID_KEY })"
