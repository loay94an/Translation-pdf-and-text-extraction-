#!/usr/bin/env python3
"""Extract one PDF into ordered per-page JSONL, TXT and RTL HTML files."""
from __future__ import annotations
import argparse, html, json, re, subprocess
from pathlib import Path

def main():
    ap = argparse.ArgumentParser(description="استخراج PDF صفحة بصفحة مع TXT وHTML")
    ap.add_argument("pdf", help="مسار ملف PDF")
    ap.add_argument("--output-dir", help="مجلد الإخراج (الافتراضي بجانب PDF)")
    ap.add_argument("--prefix", help="بادئة أسماء الملفات")
    args = ap.parse_args()
    pdf = Path(args.pdf).expanduser().resolve()
    if not pdf.is_file():
        raise SystemExit(f"ملف PDF غير موجود: {pdf}")
    if not __import__("shutil").which("pdftotext"):
        raise SystemExit("pdftotext غير مثبت. نفّذ: pkg install poppler")
    out = Path(args.output_dir).expanduser().resolve() if args.output_dir else pdf.parent / (pdf.stem + "_extracted")
    out.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or re.sub(r"[^\\w.-]+", "_", pdf.stem, flags=re.UNICODE).strip("_") or "document"
    run = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if run.returncode:
        raise SystemExit(run.stderr.strip() or "فشل pdftotext")
    chunks = run.stdout.split("\\f")
    if chunks and not chunks[-1].strip():
        chunks.pop()
    records = []
    for number, chunk in enumerate(chunks, 1):
        text = chunk.strip()
        record = {"page": number, "source_pdf": pdf.name, "text": text, "characters": len(text), "review_status": "machine_extracted_unverified"}
        records.append(record)
        (out / f"{prefix}_page_{number:04d}.txt").write_text(f"الصفحة {number} من {len(chunks)}\\n\\n{text}\\n", encoding="utf-8")
    jsonl = out / f"{prefix}.jsonl"
    jsonl.write_text("".join(json.dumps(r, ensure_ascii=False) + "\\n" for r in records), encoding="utf-8")
    txt = out / f"{prefix}.txt"
    txt.write_text("\\n\\n".join(f"{'='*24} الصفحة {r['page']} {'='*24}\\n\\n{r['text']}" for r in records) + "\\n", encoding="utf-8")
    sections = []
    for r in records:
        sections.append(f'<section class="page" id="page-{r["page"]}"><h2>الصفحة {r["page"]}</h2><pre>{html.escape(r["text"])}</pre></section>')
    html_doc = """<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>استخراج صفحات PDF</title><style>body{font-family:system-ui,'Noto Naskh Arabic',sans-serif;max-width:900px;margin:auto;padding:20px;background:#f6f7f9;color:#172033}.page{background:white;border:1px solid #d8dee8;border-radius:12px;padding:18px;margin:18px 0;break-after:page}h2{border-bottom:1px solid #ddd;padding-bottom:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.9 inherit;direction:rtl}</style></head><body><h1>النص المستخرج — صفحة مستقلة لكل جزء</h1>""" + "".join(sections) + "</body></html>"
    html_path = out / f"{prefix}.html"
    html_path.write_text(html_doc, encoding="utf-8")
    summary = {"pdf": str(pdf), "pages": len(records), "pages_with_text": sum(bool(r["text"]) for r in records), "empty_pages": [r["page"] for r in records if not r["text"]], "outputs": {"jsonl": str(jsonl), "txt": str(txt), "html": str(html_path), "page_txt_dir": str(out)}}
    (out / "extraction-report.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
