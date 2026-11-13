#!/data/data/com.termux/files/usr/bin/bash
set -u
check() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '[OK] %s: ' "$1"
    "$@" --version 2>&1 | head -n 1 || true
  else
    printf '[MISSING] %s\n' "$1"
  fi
}
check node
check python
check git
check pdftotext
check pdfimages
check pdftoppm
check tesseract
echo
echo "لغات Tesseract المتاحة:"
tesseract --list-langs 2>&1 || true
echo
echo "فحص خادم النموذج المحلي الافتراضي (llama.cpp على 8080):"
if command -v curl >/dev/null 2>&1; then
  curl --max-time 3 -fsS http://127.0.0.1:8080/v1/models || echo "غير متصل؛ شغّل llama-server أو غيّر LOCAL_MODEL_BASE_URL."
else
  echo "curl غير مثبت؛ نفّذ pkg install curl"
fi
echo
echo "المساحة الحرة:"
df -h "$HOME" 2>/dev/null | tail -n 1 || true
