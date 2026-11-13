#!/usr/bin/env python3
"""Resumable, page-level structured extraction through an OpenAI-compatible model API."""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path("assets/fashion-model-library/extracted-knowledge")
DEFAULT_INPUT = BASE / "pages-enriched"
DEFAULT_OUTPUT = BASE / "structured-pages"

SYSTEM_PROMPT = """You are a careful technical archivist for fashion-patternmaking and garment-construction references.
Extract only information explicitly present in the supplied page text. Never invent measurements, units, table cells, pattern-piece dimensions, or construction steps.
Return exactly one valid JSON object with this schema:
{
  "garment_type": null,
  "pattern_pieces": [{"name": "", "evidence": ""}],
  "measurements": [{"name": "", "value": "", "unit": "", "evidence": "", "confidence": "low"}],
  "size_tables": [{"title": "", "headers": [], "rows": [], "evidence": ""}],
  "construction_methods": [{"method": "", "evidence": ""}],
  "materials": [{"name": "", "evidence": ""}],
  "technical_terms": [{"term": "", "meaning": "", "evidence": ""}],
  "uncertainties": []
}
Use empty arrays when a category is absent and null when garment_type is not explicit.
Keep evidence short and quote the supplied text exactly. Keep values and units exactly as printed.
For size tables, include a row only when the complete row is legible in the supplied text. Do not fill gaps by guessing.
This is text-only extraction: do not claim to have seen diagrams, page images, or pattern geometry.
All output is machine-extracted and requires human verification."""

def parse_json_object(value):
    value = (value or "").strip()
    value = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", value, flags=re.I)
    start, end = value.find("{"), value.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("model response did not contain a JSON object")
    parsed = json.loads(value[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("model response JSON is not an object")
    return parsed

def call_model(text, args):
    url = args.base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": args.model,
        "temperature": 0.1,
        "max_tokens": args.max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "Book page text (may contain OCR errors):\n\n" + text[:args.max_chars]},
        ],
    }
    headers = {"Content-Type": "application/json"}
    if args.api_key:
        headers["Authorization"] = "Bearer " + args.api_key
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    last_error = None
    for attempt in range(args.retries):
        try:
            with urllib.request.urlopen(request, timeout=args.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            message = data["choices"][0]["message"].get("content", "")
            return parse_json_object(message)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, KeyError, IndexError, ValueError, json.JSONDecodeError) as error:
            last_error = error
            if attempt + 1 < args.retries:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(str(last_error))

def load_done_pages(path):
    done = {}
    if path.exists():
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                    if record.get("page") is not None and record.get("review_status") == "machine_extracted_unverified":
                        done[int(record["page"])] = record.get("source_text_sha256")
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
    return done

def normalize_extracted_data(data):
    if not isinstance(data, dict):
        raise ValueError("structured extraction must be a JSON object")
    array_fields = ("pattern_pieces", "measurements", "size_tables", "construction_methods", "materials", "technical_terms", "uncertainties")
    for field in array_fields:
        data.setdefault(field, [])
        if not isinstance(data[field], list):
            raise ValueError(f"{field} must be a JSON array")
    if data.get("garment_type") is not None and not isinstance(data["garment_type"], str):
        raise ValueError("garment_type must be a string or null")
    return data

def main():
    parser = argparse.ArgumentParser(description="Extract structured fashion-reference data from page JSONL using a local or cloud model.")
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--book-id", default="", help="Process one book ID; default processes all JSONL files.")
    parser.add_argument("--max-pages", type=int, default=0, help="Optional page limit per book for a smoke test.")
    parser.add_argument("--max-chars", type=int, default=800, help="Maximum source text characters sent per page.")
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--sleep", type=float, default=0.5)
    parser.add_argument("--base-url", default=os.environ.get("LOCAL_MODEL_BASE_URL", "http://127.0.0.1:8080/v1"))
    parser.add_argument("--model", default=os.environ.get("LOCAL_MODEL_NAME", "qwen-local"))
    parser.add_argument("--api-key", default=os.environ.get("LOCAL_MODEL_API_KEY", ""))
    args = parser.parse_args()

    if args.max_chars < 200 or args.max_tokens < 64 or args.retries < 1:
        parser.error("--max-chars must be >=200, --max-tokens >=64, and --retries >=1")
    if not args.input_dir.is_dir():
        raise SystemExit(f"Input directory not found: {args.input_dir}")
    files = sorted(args.input_dir.glob("*.jsonl"))
    if args.book_id:
        files = [item for item in files if item.stem == args.book_id]
    if not files:
        raise SystemExit("No page-enriched JSONL files matched the selected input.")

    total_done = total_skipped = total_errors = 0
    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Model endpoint: {args.base_url} | model: {args.model}", flush=True)

    report = {"schema_version": "1.0.0", "model": args.model, "endpoint": args.base_url, "books": [], "totals": {"pages_structured": 0, "pages_skipped": 0, "errors": 0}}
    for source_file in files:
        destination = args.output_dir / source_file.name
        completed = load_done_pages(destination)
        processed_this_book = 0
        book_stats = {"book_id": source_file.stem, "pages_structured": 0, "pages_skipped": 0, "errors": 0}
        with source_file.open(encoding="utf-8") as source, destination.open("a", encoding="utf-8") as output:
            for line in source:
                if not line.strip():
                    continue
                page = json.loads(line)
                page_number = int(page.get("page", 0))
                text = (page.get("combined_text") or page.get("text") or page.get("ocr_text") or "").strip()
                if not text:
                    total_skipped += 1
                    book_stats["pages_skipped"] += 1
                    continue
                digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
                if completed.get(page_number) == digest:
                    total_skipped += 1
                    book_stats["pages_skipped"] += 1
                    continue
                if args.max_pages and processed_this_book >= args.max_pages:
                    break
                try:
                    extracted = normalize_extracted_data(call_model(text, args))
                    record = {
                        "schema_version": "1.0.0",
                        "book_id": page.get("book_id", source_file.stem),
                        "title": page.get("title"),
                        "source_path": page.get("source_path"),
                        "page": page_number,
                        "source_text_sha256": digest,
                        "model": args.model,
                        "extracted_data": extracted,
                        "review_status": "machine_extracted_unverified",
                    }
                    output.write(json.dumps(record, ensure_ascii=False) + "\n")
                    output.flush()
                    completed[page_number] = digest
                    processed_this_book += 1
                    total_done += 1
                    book_stats["pages_structured"] += 1
                    print(f"[{source_file.stem}] page {page_number}: structured data saved", flush=True)
                    if args.sleep:
                        time.sleep(args.sleep)
                except Exception as error:
                    total_errors += 1
                    book_stats["errors"] += 1
                    print(f"ERROR [{source_file.stem}] page {page_number}: {error}", file=sys.stderr, flush=True)
        report["books"].append(book_stats)

    report["totals"] = {"pages_structured": total_done, "pages_skipped": total_skipped, "errors": total_errors}
    report_path = args.output_dir / "structured-extraction-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["totals"], ensure_ascii=False), flush=True)
    if total_errors:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
