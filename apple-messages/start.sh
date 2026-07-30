#!/bin/bash
# Runs the apple-messages MCP server from local source via uv.
# Editing files under this folder takes effect on the next launch — no build step.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/opt/homebrew/bin:$PATH"
exec uv run --quiet mac-messages-mcp
