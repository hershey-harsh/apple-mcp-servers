#!/bin/bash
# Runs the apple-events MCP server (Apple Reminders + Calendar) from local source.
# The native Swift EventKitCLI binary is rebuilt whenever its source changes;
# the TypeScript layer runs live via tsx, so edits under src/ deploy on next launch.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/opt/homebrew/bin:$PATH"
export HUSKY=0

# Ensure Node dependencies are present.
[ -d node_modules ] || pnpm install --ignore-scripts --silent >&2

# Rebuild the native EventKit binary if it is missing or its source changed.
BIN="bin/EventKitCLI"
SRC="src/swift/EventKitCLI.swift"
if [ ! -x "$BIN" ] || [ "$SRC" -nt "$BIN" ]; then
  node scripts/build-swift.mjs >&2
fi

exec node bin/run.cjs
