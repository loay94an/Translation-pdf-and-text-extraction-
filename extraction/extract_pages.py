import os
import json
import subprocess
import zipfile
import posixpath
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

ROOT = "assets/fashion-model-library"
CATALOG = os.path.join(ROOT, "catalog", "books.json")
OUTPUT = os.path.join(ROOT, "extracted-knowledge", "pages")
REPORT = os.path.join(ROOT, "extracted-knowledge", "extraction-report.json")
os.makedirs(OUTPUT, exist_ok=True)

if not __import__("shutil").which("pdftotext"):
    raise SystemExit("Error: pdftotext is not installed")

with open(CATALOG, encoding="utf-8") as f:
    data = json.load(f)

total_pages = 0
successful = 0
epub_successful = 0
epub_documents = 0
needs_ocr = []
errors = []


class XHTMLText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ("script", "style", "nav"):
            self.skip_depth += 1

    def handle_endtag(self, tag):
        if tag.lower() in ("script", "style", "nav") and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data):
        if not self.skip_depth and data.strip():
            self.parts.append(data.strip())

def extract_epub(book, source, destination):
    temp_destination = destination + ".tmp"
    documents = 0
    try:
        with zipfile.ZipFile(source) as archive:
            container = ET.fromstring(archive.read("META-INF/container.xml"))
            rootfile = next((node for node in container.iter() if node.tag.endswith("rootfile")), None)
            if rootfile is None:
                raise ValueError("EPUB container.xml has no rootfile")
            opf_path = rootfile.attrib["full-path"]
            opf = ET.fromstring(archive.read(opf_path))
            manifest = {}
            for node in opf.iter():
                if node.tag.endswith("item") and node.attrib.get("id"):
                    manifest[node.attrib["id"]] = node.attrib
            spine = next((node for node in opf.iter() if node.tag.endswith("spine")), None)
            if spine is None:
                raise ValueError("EPUB package has no spine")

            with open(temp_destination, "w", encoding="utf-8") as out:
                for itemref in spine:
                    if not itemref.tag.endswith("itemref"):
                        continue
                    item = manifest.get(itemref.attrib.get("idref"))
                    if not item or item.get("media-type") not in ("application/xhtml+xml", "text/html"):
                        continue
                    href = unquote(urlsplit(item["href"]).path)
                    member = posixpath.normpath(posixpath.join(posixpath.dirname(opf_path), href))
                    parser = XHTMLText()
                    parser.feed(archive.read(member).decode("utf-8", errors="replace"))
                    text = " ".join(parser.parts)
                    record = {
                        "book_id": book["id"], "title": book.get("document_title", book["title"]),
                        "page": documents + 1, "source_item": member, "text": text,
                        "content_type": "epub_spine_document",
                        "review_status": "machine_extracted_unverified"
                    }
                    out.write(json.dumps(record, ensure_ascii=False) + "\n")
                    documents += 1
        os.replace(temp_destination, destination)
        return documents
    except Exception:
        if os.path.exists(temp_destination):
            os.remove(temp_destination)
        raise

def save_report():
    report = {
        "schema_version": "1.1.0",
        "books_processed": successful,
        "epub_books_processed": epub_successful,
        "epub_documents_extracted": epub_documents,
        "total_pages_extracted": total_pages,
        "books_needing_ocr": needs_ocr,
        "errors": errors
    }
    temp = REPORT + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(temp, REPORT)

save_report()  # reset stale counters before starting this run

for book in data["books"]:
    if book.get("format") == "epub":
        source = os.path.join(ROOT, book["path"])
        destination = os.path.join(OUTPUT, book["id"] + ".jsonl")
        try:
            if not os.path.isfile(source):
                raise FileNotFoundError("EPUB missing; verify Git LFS checkout: " + source)
            docs = extract_epub(book, source, destination)
            epub_successful += 1
            epub_documents += docs
            print("EPUB extracted:", book.get("document_title", book["title"]), docs, "spine documents", flush=True)
        except Exception as e:
            errors.append({"book_id": book["id"], "title": book["title"], "error": str(e)})
            print("EPUB ERROR:", e, flush=True)
        finally:
            save_report()
        continue
    if book.get("format") != "pdf":
        continue

    source = os.path.join(ROOT, book["path"])
    destination = os.path.join(OUTPUT, book["id"] + ".jsonl")
    temp_destination = destination + ".tmp"
    print("Extracting:", book["title"], flush=True)

    try:
        if not os.path.isfile(source):
            raise FileNotFoundError("PDF missing; verify Git LFS checkout: " + source)

        result = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", source, "-"],
            capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "pdftotext failed")

        pages = result.stdout.split("\f")
        if pages and not pages[-1].strip():
            pages.pop()

        extracted = 0
        with open(temp_destination, "w", encoding="utf-8") as out:
            for number, content in enumerate(pages, 1):
                text = content.strip()
                record = {
                    "book_id": book["id"],
                    "title": book["title"],
                    "page": number,
                    "text": text,
                    "review_status": "machine_extracted_unverified"
                }
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                if text:
                    extracted += 1

        # Atomic replacement prevents a killed job from leaving a truncated book file.
        os.replace(temp_destination, destination)
        total_pages += len(pages)
        successful += 1
        if extracted == 0:
            needs_ocr.append(book["title"])
        print(f"  pages: {len(pages)} | pages with text: {extracted}", flush=True)
    except Exception as e:
        if os.path.exists(temp_destination):
            os.remove(temp_destination)
        errors.append({"book_id": book["id"], "title": book["title"], "error": str(e)})
        print("  ERROR:", e, flush=True)
    finally:
        # Save after each book, not only after the entire library.
        save_report()

print("\n===== Extraction summary =====")
print("PDF books extracted:", successful)
print("EPUB books extracted:", epub_successful)
print("EPUB spine documents:", epub_documents)
print("PDF pages extracted:", total_pages)
print("Books needing OCR:", len(needs_ocr))
print("Errors:", len(errors))
