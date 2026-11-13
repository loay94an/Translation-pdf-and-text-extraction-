#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  pkg install -y nodejs-lts
fi
mkdir -p "$HOME/workspace"
cd "$(dirname "$0")"
node agent.mjs
