#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js غير مثبت. شغّل install-termux.sh أولًا."
  exit 1
fi

BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR" "$HOME/.config/mobile-terminal-bridge"
LOG="$HOME/.config/mobile-terminal-bridge/boot-agent.log"
chmod 700 "$HOME/.config/mobile-terminal-bridge"

cat > "$BOOT_DIR/start-mobile-agent" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
sleep 8
AGENT_DIR='$AGENT_DIR'
LOG='$LOG'
mkdir -p "\$HOME/workspace" "\$HOME/.config/mobile-terminal-bridge"
chmod 700 "\$HOME/.config/mobile-terminal-bridge"
if ! pgrep -f "$AGENT_DIR/agent.mjs" >/dev/null 2>&1; then
  umask 077
  nohup node "$AGENT_DIR/agent.mjs" >> "$LOG" 2>&1 </dev/null &
fi
EOF
chmod 700 "$BOOT_DIR/start-mobile-agent"

echo "تم إعداد بدء خادم الطرفية تلقائيًا عند إقلاع الهاتف."
echo "تأكد من تثبيت تطبيق Termux:Boot من مصدر Termux نفسه، وافتحه مرة واحدة."
echo "سجل الخادم (يتضمن رمز الاتصال السري) محفوظ محليًا في: $LOG"
echo "لا تشارك هذا السجل. ويمكنك قراءة رمز الاتصال منه عند الحاجة."
