#!/usr/bin/env python3
"""Extract one PDF into ordered per-page JSONL, TXT and RTL HTML files."""
from __future__ import annotations
import argparse
import html
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="استخراج PDF صفحة بصفحة مع TXT وHTML وOCR اختياري")
    parser.add_argument("pdf", help="مسار ملف PDF")
    parser.add_argument("--output-dir", help="مجلد الإخراج (الافتراضي بجانب PDF)")
    parser.add_argument("--prefix", help="بادئة أسماء الملفات")
    parser.add_argument("--ocr-empty-pages", action="store_true", help="تشغيل Tesseract للصفحات التي لا تحتوي نصًا")
    parser.add_argument("--ocr-lang", default="ara+eng", help="لغات Tesseract، الافتراضي ara+eng")
    parser.add_argument("--dpi", type=int, default=220, help="دقة تحويل صفحات OCR")
    args = parser.parse_args()

    pdf = Path(args.pdf).expanduser().resolve()
    if not pdf.is_file():
        raise SystemExit(f"ملف PDF غير موجود: {pdf}")
    if not shutil.which("pdftotext"):
        raise SystemExit("pdftotext غير مثبت. نفّذ: pkg install poppler")

    out = Path(args.output_dir).expanduser().resolve() if args.output_dir else pdf.parent / (pdf.stem + "_extracted")
    out.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or re.sub(r"[^\w.-]+", "_", pdf.stem, flags=re.UNICODE).strip("_") or "document"

    result = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or "فشل pdftotext")

    chunks = result.stdout.split("\f")
    if chunks and not chunks[-1].strip():
        chunks.pop()
    page_texts = [chunk.strip() for chunk in chunks]
    ocr_pages = []

    if args.ocr_empty_pages:
        if not shutil.which("pdftoppm") or not shutil.which("tesseract"):
            raise SystemExit("OCR يتطلب pdftoppm وtesseract. ثبتهما عبر: pkg install poppler tesseract")
        with tempfile.TemporaryDirectory(prefix="pdf-ocr-") as temp_dir:
            for page_number, existing_text in enumerate(page_texts, 1):
                if existing_text:
                    continue
                image_base = Path(temp_dir) / f"page-{page_number:05d}"
                render = subprocess.run(
                    ["pdftoppm", "-f", str(page_number), "-l", str(page_number), "-singlefile", "-png", "-r", str(args.dpi), str(pdf), str(image_base)],
                    capture_output=True, text=True, encoding="utf-8", errors="replace"
                )
                image_path = image_base.with_suffix(".png")
                if render.returncode or not image_path.is_file():
                    ocr_pages.append({"page": page_number, "status": "render_failed", "error": render.stderr.strip()})
                    continue
                ocr = subprocess.run(
                    ["tesseract", str(image_path), "stdout", "-l", args.ocr_lang, "--psm", "3"],
                    capture_output=True, text=True, encoding="utf-8", errors="replace"
                )
                if ocr.returncode == 0:
                    page_texts[page_number - 1] = ocr.stdout.strip()
                    ocr_pages.append({"page": page_number, "status": "ocr_completed" if ocr.stdout.strip() else "ocr_empty"})
                else:
                    ocr_pages.append({"page": page_number, "status": "ocr_failed", "error": ocr.stderr.strip()})

    ocr_completed = {item["page"] for item in ocr_pages if item["status"] == "ocr_completed"}
    records = []
    for number, page_text in enumerate(page_texts, 1):
        records.append({
            "page": number,
            "source_pdf": pdf.name,
            "text": page_text,
            "characters": len(page_text),
            "review_status": "machine_extracted_unverified",
            "extraction_method": "tesseract_ocr" if number in ocr_completed else "pdftotext"
        })
        (out / f"{prefix}_page_{number:04d}.txt").write_text(
            f"الصفحة {number} من {len(page_texts)}\n\n{page_text}\n", encoding="utf-8"
        )

    jsonl = out / f"{prefix}.jsonl"
    jsonl.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8"
    )
    txt = out / f"{prefix}.txt"
    txt.write_text(
        "\n\n".join(
            f"{'=' * 24} الصفحة {record['page']} {'=' * 24}\n\n{record['text']}"
            for record in records
        ) + "\n",
        encoding="utf-8"
    )

    sections = [
        f'<section class="page" id="page-{record["page"]}">'
        f'<h2>الصفحة {record["page"]}</h2>'
        f'<pre>{html.escape(record["text"])}</pre></section>'
        for record in records
    ]
    html_doc = (
        '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>استخراج صفحات PDF</title><style>'
        "body{font-family:system-ui,'Noto Naskh Arabic',sans-serif;max-width:900px;"
        "margin:auto;padding:20px;background:#f6f7f9;color:#172033}"
        ".page{background:white;border:1px solid #d8dee8;border-radius:12px;"
        "padding:18px;margin:18px 0;break-after:page}"
        "h2{border-bottom:1px solid #ddd;padding-bottom:10px}"
        "pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9;direction:rtl}"
        "</style></head><body><h1>النص المستخرج — صفحة مستقلة لكل جزء</h1>"
        + "".join(sections) + "</body></html>"
    )
    html_path = out / f"{prefix}.html"
    html_path.write_text(html_doc, encoding="utf-8")

    report = {
        "pdf": str(pdf),
        "pages": len(records),
        "pages_with_text": sum(bool(record["text"]) for record in records),
        "empty_pages": [record["page"] for record in records if not record["text"]],
        "ocr_pages": ocr_pages,
        "outputs": {
            "jsonl": str(jsonl),
            "txt": str(txt),
            "html": str(html_path),
            "page_txt_dir": str(out)
        }
    }
    (out / "extraction-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
