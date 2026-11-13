#!/usr/bin/env python3
"""Parallel inventory and text extraction for every PDF/EPUB in the fashion library.

Full page text stays in the ephemeral runner workspace; only reports/metadata are
committed by the workflow. Each book writes to its own temporary file then atomically
replaces its output, so parallel workers never share a writable output file.
"""
import argparse
import json
import os
import posixpath
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

BASE = Path("assets/fashion-model-library")
CATALOG = BASE / "catalog/books.json"
OUT = BASE / "extracted-knowledge/pages"
REPORT = BASE / "extracted-knowledge/extraction-report.json"

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag.lower() in ("script", "style", "nav"):
            self.skip += 1
    def handle_endtag(self, tag):
        if tag.lower() in ("script", "style", "nav") and self.skip:
            self.skip -= 1
    def handle_data(self, data):
        if not self.skip and data.strip():
            self.parts.append(data.strip())

def atomic_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for row in records:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp, path)

def scan_pdf(book):
    source = BASE / book["path"]
    if not source.is_file():
        raise FileNotFoundError(f"PDF missing (check Git LFS): {source}")
    text_run = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", str(source), "-"],
        check=True, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=900
    )
    pages = text_run.stdout.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    records = [{
        "book_id": book["id"], "title": book.get("document_title", book["title"]),
        "page": n, "text": page.strip(),
        "review_status": "machine_extracted_unverified"
    } for n, page in enumerate(pages, 1)]
    atomic_jsonl(OUT / (book["id"] + ".jsonl"), records)
    image_run = subprocess.run(
        ["pdfimages", "-list", str(source)], check=True, capture_output=True,
        text=True, encoding="utf-8", errors="replace", timeout=900
    )
    image_pages = set()
    for line in image_run.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0].isdigit() and parts[1].isdigit():
            image_pages.add(int(parts[0]))
    nonempty = sum(bool(x["text"]) for x in records)
    return {
        "book_id": book["id"], "title": book["title"], "format": "pdf",
        "status": "complete", "pages": len(records), "pages_with_text": nonempty,
        "pages_with_embedded_images": len(image_pages),
        "likely_ocr_pages": sum(1 for x in records if x["page"] in image_pages and len(x["text"]) < 45)
    }

def scan_epub(book):
    source = BASE / book["path"]
    if not source.is_file():
        raise FileNotFoundError(f"EPUB missing (check Git LFS): {source}")
    records = []
    with zipfile.ZipFile(source) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        rootfile = next((x for x in container.iter() if x.tag.endswith("rootfile")), None)
        if rootfile is None:
            raise ValueError("EPUB container has no rootfile")
        opf_path = rootfile.attrib["full-path"]
        opf = ET.fromstring(z.read(opf_path))
        manifest = {x.attrib["id"]: x.attrib for x in opf.iter()
                    if x.tag.endswith("item") and x.attrib.get("id")}
        spine = next((x for x in opf.iter() if x.tag.endswith("spine")), None)
        if spine is None:
            raise ValueError("EPUB package has no spine")
        for itemref in spine:
            if not itemref.tag.endswith("itemref"):
                continue
            item = manifest.get(itemref.attrib.get("idref"))
            if not item or item.get("media-type") not in ("application/xhtml+xml", "text/html"):
                continue
            href = unquote(urlsplit(item["href"]).path)
            member = posixpath.normpath(posixpath.join(posixpath.dirname(opf_path), href))
            parser = TextParser()
            parser.feed(z.read(member).decode("utf-8", errors="replace"))
            records.append({
                "book_id": book["id"], "title": book.get("document_title", book["title"]),
                "page": len(records) + 1, "source_item": member,
                "text": " ".join(parser.parts),
                "content_type": "epub_spine_document",
                "review_status": "machine_extracted_unverified"
            })
    atomic_jsonl(OUT / (book["id"] + ".jsonl"), records)
    return {"book_id": book["id"], "title": book["title"], "format": "epub",
            "status": "complete", "documents": len(records)}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--book-workers", type=int, default=8)
    args = p.parse_args()
    if not 1 <= args.book_workers <= 12:
        p.error("--book-workers must be between 1 and 12 to avoid runner CPU and memory contention")
    with CATALOG.open(encoding="utf-8") as f:
        books = json.load(f)["books"]
    supported = [b for b in books if b.get("format") in ("pdf", "epub")]
    results, errors = [], []
    print(f"Scanning {len(supported)} books with {args.book_workers} parallel book workers", flush=True)
    def worker(book):
        if book.get("format") == "pdf":
            return scan_pdf(book)
        return scan_epub(book)
    with ThreadPoolExecutor(max_workers=args.book_workers) as pool:
        futures = {pool.submit(worker, book): book for book in supported}
        for future in as_completed(futures):
            book = futures[future]
            try:
                result = future.result()
                results.append(result)
                print(f"OK {book['id']} {book['title']}: {result.get('pages', result.get('documents', 0))} pages/documents", flush=True)
            except Exception as exc:
                errors.append({"book_id": book["id"], "title": book["title"], "error": str(exc)})
                print(f"ERROR {book['id']} {book['title']}: {exc}", flush=True)
    pdf_done = sum(x["format"] == "pdf" for x in results)
    epub_done = sum(x["format"] == "epub" for x in results)
    report = {
        "schema_version": "1.1.0", "mode": "30_way_parallel_all_books", "parallelism": "one worker per catalog book",
        "books_total": len(supported), "books_completed": len(results),
        "books_failed": len(errors), "book_workers": args.book_workers,
        "books_processed": len(results), "pdf_books_processed": pdf_done,
        "epub_books_processed": epub_done, "epub_documents_extracted": sum(x.get("documents", 0) for x in results),
        "total_pages_extracted": sum(x.get("pages", 0) for x in results),
        "pages_or_documents": sum(x.get("pages", x.get("documents", 0)) for x in results),
        "pages_with_text": sum(x.get("pages_with_text", 0) for x in results),
        "likely_ocr_pages": sum(x.get("likely_ocr_pages", 0) for x in results),
        "results": sorted(results, key=lambda x: x["book_id"]), "errors": errors
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    tmp = REPORT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, REPORT)
    print(json.dumps({k: report[k] for k in ("books_total", "books_completed", "books_failed", "pages_or_documents", "likely_ocr_pages")}, ensure_ascii=False))
    if errors:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
