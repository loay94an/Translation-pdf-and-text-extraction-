#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  pkg install -y nodejs-lts
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
export EXTRACTION_ROOT="${EXTRACTION_ROOT:-$REPO_ROOT/extraction}"
# Prefer Android shared storage for large PDFs and extraction outputs.
# Run termux-setup-storage once and grant the Android permission first.
if [[ -d "$HOME/storage/shared" ]]; then
  DEFAULT_WORKSPACE="$HOME/storage/shared/ControlCenterWorkspace"
else
  DEFAULT_WORKSPACE="$HOME/workspace"
  echo "تنبيه: التخزين المشترك غير مهيأ. نفّذ termux-setup-storage واسمح بالوصول لتخزين الكتب الكبيرة."
fi
export LOCAL_AGENT_WORKSPACE="${LOCAL_AGENT_WORKSPACE:-$DEFAULT_WORKSPACE}"
# Permit the bundled Android Studio WebView origin to call the loopback agent.
export LOCAL_AGENT_ALLOWED_ORIGINS="${LOCAL_AGENT_ALLOWED_ORIGINS:-https://appassets.androidplatform.net}"
mkdir -p "$LOCAL_AGENT_WORKSPACE" "$HOME/workspace"
echo "مساحة عمل الكتب والنتائج: $LOCAL_AGENT_WORKSPACE"
cd "$SCRIPT_DIR"
node agent.mjs
