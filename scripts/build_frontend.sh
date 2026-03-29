#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building frontend library..."
cd "$ROOT/frontend" && npm ci && npm run build

echo "==> Building app..."
cd "$ROOT/app" && npm ci && npm run build

echo "==> Copying app dist to claude_code_server/static/..."
rm -rf "$ROOT/claude_code_server/static"
cp -r "$ROOT/app/dist" "$ROOT/claude_code_server/static"

echo "==> Done. Static files at claude_code_server/static/"
