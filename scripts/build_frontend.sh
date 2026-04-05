#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building frontend library..."
cd "$ROOT/frontend" && npm ci && npm run build

echo "==> Building standalone app..."
cd "$ROOT/frontend" && npm run build:app

echo "==> Done. Static files at claude_code_server/static/"
