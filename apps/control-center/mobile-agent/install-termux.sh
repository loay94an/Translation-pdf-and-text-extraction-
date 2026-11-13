#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

echo "تجهيز Termux لأدوات استخراج المراجع..."
pkg update -y
pkg install -y nodejs-lts python git poppler tesseract curl

# Tesseract includes English data in the Termux build; install other languages separately.
for lang in ara ita por; do
  pkg install -y "tesseract-data-$lang" || echo "تنبيه: تعذر تثبيت بيانات اللغة $lang؛ يمكنك تثبيتها لاحقًا من مستودع Termux."
done

# Optional helpers for private GitHub repositories and Git LFS assets.
pkg install -y gh || echo "GitHub CLI غير متاح في المرآة الحالية؛ يمكن استخدام بيانات Git الاعتيادية."
pkg install -y git-lfs || echo "Git LFS غير متاح في المرآة الحالية؛ تحقق من ملفات PDF الكبيرة يدويًا."

mkdir -p "$HOME/workspace" "$HOME/.config/mobile-terminal-bridge"
chmod 700 "$HOME/.config/mobile-terminal-bridge"

echo
echo "تم تثبيت الأدوات الأساسية."
echo "تحقق من اللغات بالأمر: tesseract --list-langs"
echo "إذا لم تظهر ara أو ita أو por، فلا تشغّل OCR لهذه اللغات قبل تثبيت بياناتها."
