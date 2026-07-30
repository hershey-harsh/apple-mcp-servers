#!/bin/bash
# Runs the apple-maps MCP server from local source via uv.
# uv provisions a matching Python and installs deps from pyproject.toml.
# The Swift Maps helper is compiled on first use (swiftc). Editing files under
# this folder takes effect on the next launch — no manual build step.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
export PATH="/opt/homebrew/bin:$PATH"
exec uv run --quiet apple-maps-mcp
