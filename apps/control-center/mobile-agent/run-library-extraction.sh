#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
LIBRARY_ROOT="$(pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EXTRACTION_ROOT="${EXTRACTION_ROOT:-$REPO_ROOT/extraction}"
if [[ ! -f "$EXTRACTION_ROOT/extract_pages.py" || ! -f "$LIBRARY_ROOT/assets/fashion-model-library/catalog/books.json" ]]; then
  echo "لم يتم العثور على سكربتات الاستخراج أو مكتبة المراجع في مساحة العمل."
  echo "EXTRACTION_ROOT=$EXTRACTION_ROOT"
  echo "LIBRARY_ROOT=$LIBRARY_ROOT"
  exit 2
fi
for tool in pdftotext pdfimages pdftoppm tesseract; do
  command -v "$tool" >/dev/null 2>&1 || { echo "الأداة غير مثبتة: $tool"; exit 3; }
done
mkdir -p "$LIBRARY_ROOT/assets/fashion-model-library/extracted-knowledge"
echo "المرحلة 1/2: استخراج النصوص المضمنة من PDF..."
python "$EXTRACTION_ROOT/extract_pages.py"
echo "المرحلة 2/2: فهرسة الصور وتشغيل OCR للصفحات قليلة النص..."
python "$EXTRACTION_ROOT/scripts/analyze_scanned_pages.py" \
  --ocr-book-ids 9e05baa19a03,8f82f1798f14,0b057ed28a5f \
  --ocr-threshold 45 --dpi 180 --workers 2
echo "اكتمل تشغيل المرحلتين. راجع extraction-report.json وvisual-extraction-report.json."
