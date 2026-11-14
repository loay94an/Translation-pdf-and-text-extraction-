#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.local/bin" "$HOME/.config/mobile-terminal-bridge"
LAUNCHER="$HOME/.local/bin/control-center-bridge-connect"
cat > "$LAUNCHER" <<'CONNECT'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
AGENT_DIR="__AGENT_DIR__"
CONFIG="$HOME/.config/mobile-terminal-bridge"; TOKEN_FILE="$CONFIG/token"; LOG="$CONFIG/agent.log"
mkdir -p "$CONFIG" "$HOME/workspace"; chmod 700 "$CONFIG"
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || true)"
if [ "$(printf %s "$TOKEN" | wc -c)" -eq 64 ] && curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/api/health >/dev/null 2>&1; then printf "%s\n" "$TOKEN"; exit 0; fi
if ! curl -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then export LOCAL_AGENT_ALLOWED_ORIGINS="https://appassets.androidplatform.net"; [ ! -d "$HOME/storage/shared" ] || export LOCAL_AGENT_WORKSPACE="$HOME/storage/shared/ControlCenterWorkspace"; nohup node "$AGENT_DIR/agent.mjs" >>"$LOG" 2>&1 </dev/null & fi
for n in $(seq 1 25); do TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null || true)"; if [ "$(printf %s "$TOKEN" | wc -c)" -eq 64 ] && curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/api/health >/dev/null 2>&1; then printf "%s\n" "$TOKEN"; exit 0; fi; sleep 1; done
echo "تعذر تشغيل الخادم؛ راجع $LOG" >&2; exit 1
CONNECT
sed -i "s|__AGENT_DIR__|$AGENT_DIR|" "$LAUNCHER"
chmod 700 "$LAUNCHER"
echo "تم تثبيت مشغل الربط التلقائي: $LAUNCHER"
echo "فعّل allow-external-apps = true في ~/.termux/termux.properties ثم أعد تشغيل Termux."
