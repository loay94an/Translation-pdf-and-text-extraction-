#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  pkg install -y nodejs-lts
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
export EXTRACTION_ROOT="${EXTRACTION_ROOT:-$REPO_ROOT/extraction}"
mkdir -p "$HOME/workspace"
cd "$SCRIPT_DIR"
node agent.mjs
