#!/bin/bash
# Runs the apple-weather MCP server from local source (Node/TypeScript).
# Rebuilds automatically when files under src/ change, so edits deploy on next launch.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/opt/homebrew/bin:$PATH"
export HUSKY=0
[ -d node_modules ] || npm install --no-audit --no-fund --silent >&2
OUT="dist/index.js"
if [ ! -f "$OUT" ] || [ -n "$(find src -type f -newer "$OUT" 2>/dev/null | head -1)" ]; then
  npm run build >&2
fi
exec node "$OUT"
