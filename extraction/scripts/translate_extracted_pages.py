#!/usr/bin/env python3
"""Translate extracted PDF pages through a local OpenAI-compatible model in a background CLI job."""
from __future__ import annotations
import argparse
import base64
import html
import json
import mimetypes
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def emit(event: dict) -> None:
    print("@@PROGRESS " + json.dumps(event, ensure_ascii=False), flush=True)


def detect_language(text: str) -> str:
    try:
        from langdetect import detect
        return detect(text[:4000]) if text.strip() else "und"
    except Exception:
        if re.search(r"[\u0600-\u06ff]", text):
            return "ar"
        if re.search(r"[A-Za-z]", text):
            return "auto"
        return "auto"


def split_text(text: str, limit: int) -> list[str]:
    chunks = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind("\n\n", 0, limit)
        if cut < limit // 3:
            cut = remaining.rfind("\n", 0, limit)
        if cut < limit // 3:
            cut = remaining.rfind(" ", 0, limit)
        if cut < limit // 3:
            cut = limit
        else:
            cut += 1
        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def request_translation(base_url: str, model: str, api_key: str, source: str, target: str,
                        text: str, temperature: float, max_tokens: int, retries: int) -> str:
    language_instruction = "Detect the source language automatically." if source == "auto" else f"The source language is {source}."
    prompt = (
        "Translate the supplied document text faithfully. Preserve meaning, technical terminology, "
        "numbers, units, headings, lists, and paragraph structure. Do not summarize, explain, or add facts. "
        "Return only the translation. If the text is already in the target language, return it unchanged.\n"
        f"{language_instruction}\nTarget language: {target}.\n\nDOCUMENT TEXT:\n{text}"
    )
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a careful professional document translator. Output only the requested translation."},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    request = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", data=payload, headers=headers, method="POST")
    last_error = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                data = json.loads(response.read().decode("utf-8"))
            result = data.get("choices", [{}])[0].get("message", {}).get("content")
            if not isinstance(result, str) or not result.strip():
                raise RuntimeError("النموذج المحلي لم يرجع ترجمة نصية")
            return result.strip()
        except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError, KeyError, IndexError) as error:
            last_error = error
            if attempt < retries:
                time.sleep(min(2 ** attempt, 8))
    raise RuntimeError(f"فشلت الترجمة بعد المحاولات: {last_error}")


def image_data(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return "data:" + mime + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser(description="ترجمة صفحات JSONL باستخدام النموذج المحلي")
    parser.add_argument("input_jsonl")
    parser.add_argument("--pdf", default="")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--prefix", default="document")
    parser.add_argument("--source-language", default="auto")
    parser.add_argument("--target-language", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--base-url", default=os.environ.get("LOCAL_MODEL_BASE_URL", "http://127.0.0.1:8080/v1"))
    parser.add_argument("--image-mode", choices=("none", "page", "extracted"), default="none")
    parser.add_argument("--html-content", choices=("both", "translation", "original"), default="both")
    parser.add_argument("--temperature", type=float, default=0.1)
    parser.add_argument("--max-tokens", type=int, default=512)
    parser.add_argument("--chunk-chars", type=int, default=1200)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--dpi", type=int, default=150)
    args = parser.parse_args()
    if args.chunk_chars < 200 or args.chunk_chars > 12000:
        raise SystemExit("--chunk-chars يجب أن يكون بين 200 و12000")

    source_file = Path(args.input_jsonl).expanduser().resolve()
    if not source_file.is_file():
        raise SystemExit(f"ملف JSONL غير موجود: {source_file}")
    pdf = Path(args.pdf).expanduser().resolve() if args.pdf else None
    if args.image_mode != "none" and (not pdf or not pdf.is_file()):
        raise SystemExit("إرفاق الصور يتطلب تحديد ملف PDF الأصلي")
    if args.image_mode == "page" and not shutil_which("pdftoppm"):
        raise SystemExit("صور الصفحات تتطلب pdftoppm (حزمة poppler)")
    if args.image_mode == "extracted":
        try:
            import fitz  # PyMuPDF
        except ImportError:
            raise SystemExit("استخراج الصور المضمنة يتطلب PyMuPDF: pip install pymupdf")
    if not 100 <= args.dpi <= 300:
        raise SystemExit("--dpi يجب أن يكون بين 100 و300")

    total = 0
    with source_file.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as error:
                raise SystemExit(f"JSONL غير صالح في السطر {line_no}: {error}")
            if not isinstance(item.get("text"), str):
                raise SystemExit(f"السطر {line_no} لا يحتوي text")
            total += 1
    if total == 0:
        raise SystemExit("ملف JSONL لا يحتوي صفحات")

    out = Path(args.output_dir).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    prefix = re.sub(r"[^\w.-]+", "_", args.prefix, flags=re.UNICODE).strip("_.") or "document"
    assets = out / (prefix + "_images")
    if args.image_mode != "none":
        assets.mkdir(parents=True, exist_ok=True)

    jsonl = out / f"{prefix}_translated.jsonl"
    txt = out / f"{prefix}_translated.txt"
    html_path = out / f"{prefix}_translated.html"
    emit({"event": "started", "stage": "translation", "completed": 0, "total": total, "percent": 0})
    failures = []
    translated_count = 0
    api_key = os.environ.get("LOCAL_MODEL_API_KEY", "")
    fitz_doc = None
    if args.image_mode == "extracted":
        import fitz
        fitz_doc = fitz.open(pdf)

    html_header = ('<!doctype html><html lang="' + html.escape(args.target_language) + '" dir="auto"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                   '<title>ترجمة المستند</title><style>body{font-family:system-ui,sans-serif;max-width:1000px;margin:auto;padding:20px;background:#f5f7fa;color:#172033}.page{background:white;border:1px solid #d8dee8;border-radius:12px;padding:18px;margin:18px 0;break-after:page}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.9}figure{margin:12px 0}img{max-width:100%;height:auto;border:1px solid #ddd;border-radius:8px}small{color:#68758a}</style></head><body><h1>النص والترجمة</h1>\n')
    try:
        with source_file.open(encoding="utf-8") as source_handle, \
             jsonl.open("w", encoding="utf-8", newline="\n") as jsonl_file, \
             txt.open("w", encoding="utf-8", newline="\n") as txt_file, \
             html_path.open("w", encoding="utf-8", newline="\n") as html_file:
            html_file.write(html_header)
            index = 0
            for line_no, line in enumerate(source_handle, 1):
                if not line.strip():
                    continue
                index += 1
                record = json.loads(line)
                original = record["text"]
                page = int(record.get("page", index))
                detected = detect_language(original) if args.source_language == "auto" else args.source_language
                result = ""
                status = "completed"
                try:
                    result = "\n\n".join(
                        request_translation(args.base_url, args.model, api_key, detected, args.target_language,
                                            chunk, args.temperature, args.max_tokens, args.retries)
                        for chunk in split_text(original, args.chunk_chars)
                    ) if original.strip() else ""
                    if not original.strip():
                        status = "empty_source"
                except Exception as error:
                    status = "translation_failed"
                    failures.append({"page": page, "error": str(error)})

                image_names = []
                if fitz_doc:
                    page_index = page - 1
                    if 0 <= page_index < len(fitz_doc):
                        for image_index, info in enumerate(fitz_doc[page_index].get_images(full=True), 1):
                            try:
                                data = fitz_doc.extract_image(info[0])
                                ext = data.get("ext", "png")
                                image_path = assets / f"page-{page:04d}-image-{image_index:02d}.{ext}"
                                image_path.write_bytes(data["image"])
                                image_names.append(image_path.name)
                            except Exception:
                                continue
                elif args.image_mode == "page":
                    base = assets / f"page-{page:04d}"
                    rendered = subprocess.run(
                        ["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-jpeg",
                         "-r", str(args.dpi), str(pdf), str(base)],
                        capture_output=True, text=True)
                    image_path = base.with_suffix(".jpg")
                    if rendered.returncode == 0 and image_path.is_file():
                        image_names.append(image_path.name)

                item = {
                    "page": page, "source_pdf": pdf.name if pdf else record.get("source_pdf", ""),
                    "source_language": detected, "target_language": args.target_language,
                    "original_text": original, "translated_text": result, "status": status,
                    "characters": len(result), "images": image_names,
                }
                jsonl_file.write(json.dumps(item, ensure_ascii=False) + "\n")
                if index > 1:
                    txt_file.write("\n\n")
                txt_file.write(f"========== الصفحة {page} | {detected} → {args.target_language} ==========\n")
                if args.html_content in ("both", "original"):
                    txt_file.write(f"[النص الأصلي]\n{original}\n\n")
                if args.html_content != "original":
                    txt_file.write(f"[الترجمة]\n{result}")
                images_html = "".join(
                    f'<figure><img loading="lazy" src="{image_data(assets / name)}" alt="صورة أصلية من الصفحة {page}"></figure>'
                    for name in image_names
                )
                original_html = f'<h3>النص الأصلي</h3><pre>{html.escape(original)}</pre>' if args.html_content in ("both", "original") else ""
                translation_html = f'<h3>الترجمة ({html.escape(args.target_language)})</h3><pre>{html.escape(result)}</pre>' if args.html_content in ("both", "translation") else ""
                html_file.write(
                    f'<section class="page" id="page-{page}"><h2>الصفحة {page} · {html.escape(detected)} ← {html.escape(args.target_language)}</h2>'
                    f'{images_html}{original_html}{translation_html}<small>الحالة: {html.escape(status)}</small></section>\n'
                )
                if status == "completed":
                    translated_count += 1
                emit({"event": "progress", "stage": "translation", "completed": index, "total": total,
                      "percent": round(index * 100 / total, 1), "page": page, "status": status})
            html_file.write("</body></html>\n")
    finally:
        if fitz_doc:
            fitz_doc.close()

    report = {"input": str(source_file), "pages": total, "translated": translated_count,
              "failed": failures, "source_language": args.source_language, "target_language": args.target_language,
              "model": args.model, "image_mode": args.image_mode, "html_content": args.html_content,
              "chunk_chars": args.chunk_chars, "max_tokens": args.max_tokens,
              "outputs": {"jsonl": str(jsonl), "txt": str(txt), "html": str(html_path),
                          "images": str(assets) if args.image_mode != "none" else None}}
    (out / f"{prefix}_translation-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    emit({"event": "completed", "stage": "finished", "completed": total, "total": total, "percent": 100,
          "failures": len(failures), "outputs": report["outputs"]})
    print(json.dumps(report, ensure_ascii=False, indent=2))

def shutil_which(name: str) -> str | None:
    import shutil
    return shutil.which(name)


if __name__ == "__main__":
    main()
