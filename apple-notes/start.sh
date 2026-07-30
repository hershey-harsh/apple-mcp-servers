#!/bin/bash
# Runs the apple-notes MCP server from local source (Node/TypeScript).
# Rebuilds automatically when files under src/ change, so edits deploy on next launch.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/opt/homebrew/bin:$PATH"
export HUSKY=0
[ -d node_modules ] || pnpm install --silent >&2
OUT="build/index.js"
if [ ! -f "$OUT" ] || [ -n "$(find src -type f -newer "$OUT" 2>/dev/null | head -1)" ]; then
  pnpm run build >&2
fi
exec node "$OUT"
