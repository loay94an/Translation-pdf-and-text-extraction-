#!/usr/bin/env python3
"""Build an Arabic progress dashboard from durable, persisted extraction outputs."""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("assets/fashion-model-library")
KNOWLEDGE = ROOT / "extracted-knowledge"
OUT_JSON = KNOWLEDGE / "library-progress.json"
OUT_MD = ROOT / "LIBRARY_PROGRESS_AR.md"

def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default

def count_jsonl(path):
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as stream:
        return sum(1 for line in stream if line.strip())

catalog = load_json(ROOT / "catalog/books.json", {"books": []})
books = catalog.get("books", [])
extraction = load_json(KNOWLEDGE / "extraction-report.json", {})
visual = load_json(KNOWLEDGE / "visual-extraction-report.json", {})
total_pages = int(extraction.get("total_pages_extracted", 0))
pdf_books_done = int(extraction.get("books_processed", 0))
epub_books_done = int(extraction.get("epub_books_processed", 0))
books_done = pdf_books_done + epub_books_done
ocr_pages = sum(count_jsonl(p) for p in (KNOWLEDGE / "ocr-pages").glob("*.jsonl"))
enriched_pages = sum(count_jsonl(p) for p in (KNOWLEDGE / "pages-enriched").glob("*.jsonl"))
state_dir = KNOWLEDGE / "page-state"
page_state_files = list(state_dir.glob("*/*.json")) if state_dir.exists() else []
page_state_pages = len(page_state_files)

# Persist a copyright-conscious page ledger: counts, candidate tags and review state only.
# Full extracted text and OCR remain in the temporary runner workspace.
ledger_path = KNOWLEDGE / "page-progress-ledger.jsonl"
ledger_tmp = ledger_path.with_suffix(".jsonl.tmp")
ledger_rows = []
for state_file in sorted(page_state_files):
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
        item = state.get("enriched", {})
        visual_item = state.get("visual", {})
        ledger_rows.append({
            "schema_version": "1.0.0",
            "book_id": state.get("book_id"),
            "page": state.get("page"),
            "source_path": item.get("source_path"),
            "text_characters": len(item.get("text", "")),
            "ocr_characters": len(item.get("ocr_text", "")),
            "ocr_language_model": item.get("ocr_language_model"),
            "ocr_mean_word_confidence": item.get("ocr_mean_word_confidence"),
            "embedded_image_count": visual_item.get("embedded_image_count", 0),
            "candidate_topics": item.get("candidate_topics", []),
            "dimension_strings_unverified": item.get("dimension_strings_unverified", []),
            "review_status": "machine_extracted_unverified",
            "visual_review_status": "visual_review_required"
        })
    except (OSError, json.JSONDecodeError, TypeError):
        continue
ledger_path.parent.mkdir(parents=True, exist_ok=True)
with ledger_tmp.open("w", encoding="utf-8") as stream:
    for row in ledger_rows:
        stream.write(json.dumps(row, ensure_ascii=False) + "\n")
ledger_tmp.replace(ledger_path)
visual_totals = visual.get("totals", {})
errors = len(extraction.get("errors", [])) + int(visual_totals.get("errors", 0))
pdf_books = sum(1 for b in books if b.get("format") == "pdf")
epub_books = sum(1 for b in books if b.get("format") == "epub")
percent = round(100 * books_done / len(books)) if books else 0
now = datetime.now(timezone.utc).isoformat(timespec="seconds")
state = "لم يبدأ الاستخراج الآلي بعد" if not extraction else ("يحتاج معالجة أخطاء" if errors else "استخراج أولي مسجل")

data = {
    "schema_version": "1.1.0",
    "updated_at_utc": now,
    "repository_catalog": {"books_total": len(books), "pdf_books": pdf_books, "epub_books": epub_books},
    "text_extraction": {"books_processed": books_done, "books_total": len(books), "pdf_books_processed": pdf_books_done, "pdf_books_total": pdf_books, "progress_percent": percent, "pages_extracted": total_pages},
    "epub_extraction": {"books_total": epub_books, "books_processed": epub_books_done, "spine_documents_extracted": int(extraction.get("epub_documents_extracted", 0)), "status": "processed" if epub_books_done == epub_books else "pending_or_failed"},
    "ocr": {"pages_with_records": ocr_pages, "status": "machine_extracted_unverified"},
    "page_checkpoints": {"pages_with_runner_local_state": page_state_pages, "persisted_sanitized_ledger_records": len(ledger_rows), "status": "full_text_temporary_runner_workspace_sanitized_ledger_committed_to_branch"},
    "classification": {"pages_with_enriched_records": enriched_pages, "status": "automated_candidates_unreviewed"},
    "visual_review": {"human_reviewed_pages": 0, "status": "not_claimed_by_automated_inventory"},
    "pattern_validation": {"production_cad_patterns_verified": 0},
    "errors": errors,
    "status": state,
    "limitations": [
        "Counts represent files visible in the current runner workspace; they do not prove durable cross-run persistence.",
        "Full per-page text and OCR checkpoints are temporary runner-local files; only a sanitized page-progress ledger is committed to the private branch.",
        "OCR and keyword classification are unverified machine outputs, not human visual review.",
        "Embedded-image inventory does not extract pattern geometry.",
        "No production-ready CAD patterns are certified by this dashboard."
    ]
}
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
tmp = OUT_JSON.with_suffix(".json.tmp")
tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
tmp.replace(OUT_JSON)

lines = [
    "# مؤشر تقدم مكتبة مراجع الأزياء والباترونات",
    "",
    f"> آخر تحديث (UTC): {now}",
    "",
    f"## تقدم استخراج الكتب: {percent}%",
    "",
    f"- الكتب في الفهرس: **{len(books)}** (PDF: {pdf_books}، EPUB: {epub_books})",
    f"- الكتب المعالجة: **{books_done}/{len(books)}**",
    f"- ملفات PDF المعالجة: **{pdf_books_done}/{pdf_books}**",
    f"- ملفات EPUB المعالجة: **{epub_books_done}/{epub_books}**، المستندات الداخلية: **{int(extraction.get('epub_documents_extracted', 0))}**",
    f"- الصفحات المستخرجة نصيًا: **{total_pages}**",
    f"- الصفحات ذات سجلات OCR: **{ocr_pages}** (ناتج آلي غير متحقق)",
    f"- الصفحات ذات سجلات التصنيف: **{enriched_pages}**",
    f"- الصفحات التي لها نقاط حفظ محلية: **{page_state_pages}**؛ وسجلات فهرس تقدم مختصرة محفوظة في المستودع: **{len(ledger_rows)}**",
    f"- الصفحات التي خضعت لمراجعة بشرية: **0 مسجلة في هذا المؤشر**",
    "- باترونات CAD الإنتاجية المتحقق منها: **0**",
    f"- الأخطاء المسجلة: **{errors}**",
    "",
    "## حالة النظام",
    f"**{state}**",
    "",
    "يُحسب التقدم من الملفات الموجودة في مساحة التشغيل الحالية. النصوص الكاملة وOCR التفصيلي مؤقتة؛ الذي يُحفظ في الفرع هو سجل صفحات مختصر لا يتضمن نص المصدر. ولا تعني معالجة الكتاب اكتمال مراجعته أو تحويله إلى معرفة هندسية معتمدة.",
    "",
    "## حدود التحقق",
    "- OCR والتصنيف الآلي لا يعادلان التعرف البصري البشري على الباترونات.",
    "- فهرسة الصور لا تعني استخراج حدود القطع أو هندستها.",
    "- لا تُستخدم القياسات المستخرجة آليًا في قص إنتاجي قبل المراجعة والمعايرة.",
    "- لا تُرفع ملفات PDF الأصلية أو صفحاتها المصورة إلى مخرجات المعرفة.",
    "- النصوص الكاملة وOCR التفصيلي لا تُحفظ بين التشغيلات؛ يُحفظ سجل تقدم مختصر فقط. لذلك لا يتيح السجل وحده استئناف OCR من منتصف الصفحة دون إعادة التعرف عليها.",
    "",
    "البيانات الآلية: [library-progress.json](extracted-knowledge/library-progress.json)",
    "سجل الصفحات: [Extraction ledger](EXTRACTION_PROGRESS_LEDGER_AR.md)",
    ""
]
OUT_MD.write_text("\n".join(lines), encoding="utf-8")
print(json.dumps({
    "books_total": len(books), "books_processed": books_done,
    "pages_extracted": total_pages, "ocr_records": ocr_pages,
    "enriched_records": enriched_pages, "page_checkpoints": page_state_pages,
    "errors": errors, "dashboard": str(OUT_MD)
}, ensure_ascii=False))
