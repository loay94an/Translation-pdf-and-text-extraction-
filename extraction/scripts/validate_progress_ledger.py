#!/usr/bin/env python3
"""Validate the sanitized page-progress ledger before it is committed."""
import json
import sys
from pathlib import Path

LEDGER = Path("assets/fashion-model-library/extracted-knowledge/page-progress-ledger.jsonl")
REQUIRED = {
    "schema_version", "book_id", "page", "source_path",
    "text_characters", "ocr_characters", "ocr_language_model",
    "ocr_mean_word_confidence", "embedded_image_count",
    "candidate_topics", "dimension_strings_unverified",
    "review_status", "visual_review_status",
}
FORBIDDEN = {"text", "ocr_text", "combined_text", "page_text", "full_text"}


def find_forbidden_keys(value, path=""):
    """Find raw-text field names at any nesting depth."""
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            current = f"{path}.{key}" if path else key
            if isinstance(key, str) and key.lower() in FORBIDDEN:
                found.append(current)
            found.extend(find_forbidden_keys(child, current))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_forbidden_keys(child, f"{path}[{index}]"))
    return found


def main():
    if not LEDGER.exists():
        print(f"ERROR: ledger missing: {LEDGER}", file=sys.stderr)
        return 2

    seen = set()
    count = 0
    books = set()
    with LEDGER.open(encoding="utf-8") as stream:
        for line_no, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                print(f"ERROR: invalid JSON on line {line_no}: {exc}", file=sys.stderr)
                return 2

            if not isinstance(row, dict):
                print(f"ERROR: line {line_no} must contain a JSON object", file=sys.stderr)
                return 2

            missing = REQUIRED - row.keys()
            if missing:
                print(f"ERROR: line {line_no} missing fields: {sorted(missing)}", file=sys.stderr)
                return 2

            leaked = find_forbidden_keys(row)
            if leaked:
                print(f"ERROR: raw text fields are forbidden on line {line_no}: {leaked}", file=sys.stderr)
                return 2

            if not isinstance(row["book_id"], str) or not row["book_id"].strip():
                print(f"ERROR: invalid book_id on line {line_no}", file=sys.stderr)
                return 2
            if not isinstance(row["source_path"], str) or not row["source_path"].strip():
                print(f"ERROR: invalid source_path on line {line_no}", file=sys.stderr)
                return 2
            if isinstance(row["page"], bool) or not isinstance(row["page"], int) or row["page"] < 1:
                print(f"ERROR: invalid page number on line {line_no}", file=sys.stderr)
                return 2
            if not isinstance(row["candidate_topics"], list) or not isinstance(row["dimension_strings_unverified"], list):
                print(f"ERROR: candidate_topics and dimension_strings_unverified must be arrays on line {line_no}", file=sys.stderr)
                return 2

            key = (row["book_id"], row["page"])
            if key in seen:
                print(f"ERROR: duplicate page record: {key}", file=sys.stderr)
                return 2
            seen.add(key)
            books.add(row["book_id"])
            count += 1

    print(json.dumps({
        "ledger": str(LEDGER),
        "valid_records": count,
        "books": len(books),
        "unique_pages": len(seen),
        "jsonl_valid": True,
        "raw_page_text_absent": True,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
