#!/usr/bin/env python3
"""Resumable, page-aware PDF extraction with measurable progress and OCR fallback."""
from __future__ import annotations
import argparse
import html
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def emit(event: dict) -> None:
    print("@@PROGRESS " + json.dumps(event, ensure_ascii=False), flush=True)


def run():
    parser = argparse.ArgumentParser(description="استخراج PDF صفحة بصفحة مع تقدم حقيقي وOCR قابل للضبط")
    parser.add_argument("pdf", help="مسار ملف PDF")
    parser.add_argument("--output-dir", help="مجلد الإخراج")
    parser.add_argument("--prefix", help="بادئة أسماء الملفات")
    parser.add_argument("--ocr-empty-pages", action="store_true", help="توافق قديم: OCR للصفحات الفارغة")
    parser.add_argument("--ocr-mode", choices=("none", "empty", "weak", "all"), default=None,
                        help="none=نص PDF فقط، empty=الفارغة، weak=النصوص القصيرة، all=كل الصفحات")
    parser.add_argument("--min-text-chars", type=int, default=40,
                        help="أقل عدد أحرف قبل اعتبار الصفحة ضعيفة (افتراضي 40)")
    parser.add_argument("--ocr-lang", default="ara+eng", help="لغات Tesseract")
    parser.add_argument("--dpi", type=int, default=220, help="دقة OCR من 100 إلى 400")
    parser.add_argument("--psm", type=int, choices=range(0, 14), default=3, help="Tesseract page segmentation mode")
    args = parser.parse_args()

    pdf = Path(args.pdf).expanduser().resolve()
    if not pdf.is_file():
        raise SystemExit(f"ملف PDF غير موجود: {pdf}")
    if not shutil.which("pdftotext"):
        raise SystemExit("pdftotext غير مثبت. نفّذ: pkg install poppler")
    if not 100 <= args.dpi <= 400:
        raise SystemExit("--dpi يجب أن يكون بين 100 و400")
    if args.min_text_chars < 1:
        raise SystemExit("--min-text-chars يجب أن يكون أكبر من صفر")
    mode = args.ocr_mode or ("empty" if args.ocr_empty_pages else "none")

    out = Path(args.output_dir).expanduser().resolve() if args.output_dir else pdf.parent / (pdf.stem + "_extracted")
    out.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or re.sub(r"[^\w.-]+", "_", pdf.stem, flags=re.UNICODE).strip("_") or "document"
    emit({"event": "started", "stage": "reading_pdf", "completed": 0, "total": 0})

    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, encoding="utf-8", errors="replace") if shutil.which("pdfinfo") else None
    total = 0
    if info and info.returncode == 0:
        match = re.search(r"^Pages:\s+(\d+)", info.stdout, re.MULTILINE)
        if match:
            total = int(match.group(1))

    expected_pages = total
    if mode != "none" and (not shutil.which("pdftoppm") or not shutil.which("tesseract")):
        raise SystemExit("OCR يتطلب pdftoppm وtesseract. ثبتهما عبر: pkg install poppler tesseract")

    jsonl = out / f"{prefix}.jsonl"
    txt = out / f"{prefix}.txt"
    html_path = out / f"{prefix}.html"
    empty_pages: list[int] = []
    ocr_pages: list[dict] = []
    failures: list[dict] = []
    pages_with_text = 0
    total_seen = 0

    def iter_pages(stream, expected: int):
        buffer = ""
        yielded = 0
        while True:
            block = stream.read(65536)
            if not block:
                break
            buffer += block
            while "\\f" in buffer:
                page, buffer = buffer.split("\\f", 1)
                yielded += 1
                yield page
        if buffer or yielded == 0:
            yielded += 1
            yield buffer
        while expected and yielded < expected:
            yielded += 1
            yield ""

    emit({"event": "progress", "stage": "extracting", "completed": 0, "total": expected_pages, "percent": 0})
    # pdftotext writes to disk, then each page is consumed incrementally.
    # This avoids holding the whole book, every page record, and the full HTML in RAM.
    with tempfile.TemporaryDirectory(prefix="pdf-work-", dir=out) as temp_dir:
        temp_root = Path(temp_dir)
        raw_text_path = temp_root / "source.txt"
        result = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), str(raw_text_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace")
        if result.returncode:
            raise SystemExit(result.stderr.strip() or "فشل pdftotext")
        if not raw_text_path.is_file():
            raise SystemExit("لم ينتج pdftotext ملف النص المؤقت")
        with jsonl.open("w", encoding="utf-8", newline="\\n") as jsonl_file, \\
             txt.open("w", encoding="utf-8", newline="\\n") as txt_file, \\
             html_path.open("w", encoding="utf-8", newline="\\n") as html_file:
            html_file.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>استخراج صفحات PDF</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:auto;padding:20px;background:#f6f7f9;color:#172033}.page{background:white;border:1px solid #d8dee8;border-radius:12px;padding:18px;margin:18px 0;break-after:page}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;direction:rtl}</style></head><body><h1>النص المستخرج</h1>\\n')
            with raw_text_path.open("r", encoding="utf-8", errors="replace", newline="") as raw_file:
                for number, raw_page in enumerate(iter_pages(raw_file, expected_pages), 1):
                    original = raw_page.strip()
                    text = original
                    method = "pdftotext"
                    status = "completed"
                    should_ocr = mode == "all" or (mode == "empty" and not original) or (mode == "weak" and len(original) < args.min_text_chars)
                    if should_ocr:
                        image_base = temp_root / f"page-{number:05d}"
                        render = subprocess.run(
                            ["pdftoppm", "-f", str(number), "-l", str(number), "-singlefile", "-png", "-r", str(args.dpi), str(pdf), str(image_base)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
                        image_path = image_base.with_suffix(".png")
                        if render.returncode or not image_path.is_file():
                            status = "render_failed"
                            failures.append({"page": number, "stage": "render", "error": render.stderr.strip()})
                        else:
                            ocr = subprocess.run(
                                ["tesseract", str(image_path), "stdout", "-l", args.ocr_lang, "--psm", str(args.psm)],
                                capture_output=True, text=True, encoding="utf-8", errors="replace")
                            if ocr.returncode == 0:
                                candidate = ocr.stdout.strip()
                                if len(candidate) > len(text):
                                    text = candidate
                                    method = "tesseract_ocr"
                                status = "ocr_completed" if candidate else "ocr_empty"
                            else:
                                status = "ocr_failed"
                                failures.append({"page": number, "stage": "ocr", "error": ocr.stderr.strip()})
                        ocr_pages.append({"page": number, "status": status, "original_characters": len(original), "result_characters": len(text)})

                    if text:
                        pages_with_text += 1
                    else:
                        empty_pages.append(number)
                    total_seen = number
                    record = {"page": number, "source_pdf": pdf.name, "text": text, "characters": len(text),
                              "review_status": "machine_extracted_unverified", "extraction_method": method,
                              "ocr_status": status if should_ocr else "not_requested"}
                    jsonl_file.write(json.dumps(record, ensure_ascii=False) + "\\n")
                    txt_file.write(f"{'=' * 24} الصفحة {number} {'=' * 24}\\n\\n{text}\\n\\n")
                    (out / f"{prefix}_page_{number:04d}.txt").write_text(
                        f"الصفحة {number} من {expected_pages or '?'}\\n\\n{text}\\n", encoding="utf-8")
                    html_file.write(f'<section class="page" id="page-{number}"><h2>الصفحة {number}</h2><pre>{html.escape(text)}</pre></section>\\n')
                    progress_total = expected_pages or number
                    emit({"event": "progress", "stage": "extracting", "completed": number, "total": progress_total,
                          "percent": round(number * 100 / progress_total, 1) if progress_total else 0,
                          "page": number, "characters": len(text), "method": method, "status": status})
            html_file.write("</body></html>\\n")

    total = total_seen
    if total == 0:
        raise SystemExit("لم يتم العثور على صفحات في ملف PDF")
    report = {"pdf": str(pdf), "pages": total, "pages_with_text": pages_with_text,
              "empty_pages": empty_pages, "ocr_mode": mode,
              "ocr_settings": {"languages": args.ocr_lang, "dpi": args.dpi, "psm": args.psm, "min_text_chars": args.min_text_chars},
              "ocr_pages": ocr_pages, "failures": failures,
              "outputs": {"jsonl": str(jsonl), "txt": str(txt), "html": str(html_path), "page_txt_dir": str(out)}}
    (out / "extraction-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
    emit({"event": "completed", "stage": "finished", "completed": total, "total": total, "percent": 100,
          "failures": len(failures), "outputs": report["outputs"]})
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
