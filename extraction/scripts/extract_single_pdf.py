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

    result = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"],
                            capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise SystemExit(result.stderr.strip() or "فشل pdftotext")
    chunks = result.stdout.split("\f")
    if chunks and not chunks[-1].strip():
        chunks.pop()
    page_texts = [chunk.strip() for chunk in chunks]
    total = len(page_texts)
    if total == 0:
        raise SystemExit("لم يتم العثور على صفحات في ملف PDF")

    if mode != "none" and (not shutil.which("pdftoppm") or not shutil.which("tesseract")):
        raise SystemExit("OCR يتطلب pdftoppm وtesseract. ثبتهما عبر: pkg install poppler tesseract")

    records = []
    ocr_pages = []
    failures = []
    selected = 0
    emit({"event": "progress", "stage": "extracting", "completed": 0, "total": total, "percent": 0})
    with tempfile.TemporaryDirectory(prefix="pdf-ocr-") as temp_dir:
        for number, original in enumerate(page_texts, 1):
            text = original
            method = "pdftotext"
            status = "completed"
            should_ocr = mode == "all" or (mode == "empty" and not original) or (mode == "weak" and len(original.strip()) < args.min_text_chars)
            if should_ocr:
                selected += 1
                image_base = Path(temp_dir) / f"page-{number:05d}"
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
            record = {"page": number, "source_pdf": pdf.name, "text": text, "characters": len(text),
                      "review_status": "machine_extracted_unverified", "extraction_method": method,
                      "ocr_status": status if should_ocr else "not_requested"}
            records.append(record)
            (out / f"{prefix}_page_{number:04d}.txt").write_text(
                f"الصفحة {number} من {total}\n\n{text}\n", encoding="utf-8")
            emit({"event": "progress", "stage": "extracting", "completed": number, "total": total,
                  "percent": round(number * 100 / total, 1), "page": number, "characters": len(text),
                  "method": method, "status": status})

    jsonl = out / f"{prefix}.jsonl"
    jsonl.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")
    txt = out / f"{prefix}.txt"
    txt.write_text("\n\n".join(f"{'=' * 24} الصفحة {r['page']} {'=' * 24}\n\n{r['text']}" for r in records) + "\n", encoding="utf-8")
    sections = [f'<section class="page" id="page-{r["page"]}"><h2>الصفحة {r["page"]}</h2><pre>{html.escape(r["text"])}</pre></section>' for r in records]
    html_doc = ('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                '<title>استخراج صفحات PDF</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:auto;padding:20px;background:#f6f7f9;color:#172033}.page{background:white;border:1px solid #d8dee8;border-radius:12px;padding:18px;margin:18px 0;break-after:page}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;direction:rtl}</style></head><body><h1>النص المستخرج</h1>'
                + "".join(sections) + "</body></html>")
    html_path = out / f"{prefix}.html"
    html_path.write_text(html_doc, encoding="utf-8")
    report = {"pdf": str(pdf), "pages": total, "pages_with_text": sum(bool(r["text"]) for r in records),
              "empty_pages": [r["page"] for r in records if not r["text"]], "ocr_mode": mode,
              "ocr_settings": {"languages": args.ocr_lang, "dpi": args.dpi, "psm": args.psm, "min_text_chars": args.min_text_chars},
              "ocr_pages": ocr_pages, "failures": failures,
              "outputs": {"jsonl": str(jsonl), "txt": str(txt), "html": str(html_path), "page_txt_dir": str(out)}}
    (out / "extraction-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    emit({"event": "completed", "stage": "finished", "completed": total, "total": total, "percent": 100,
          "failures": len(failures), "outputs": report["outputs"]})
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()
