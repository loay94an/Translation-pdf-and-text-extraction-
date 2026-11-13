#!/usr/bin/env python3
"""Page-level OCR and visual inventory for scanned fashion references."""
import argparse, csv, json, re, subprocess, sys, tempfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE=Path("assets/fashion-model-library")
CATALOG=BASE/"catalog/books.json"
KNOWLEDGE=BASE/"extracted-knowledge"
PAGE_TEXT=KNOWLEDGE/"pages"
OCR_OUTPUT=KNOWLEDGE/"ocr-pages"
ENRICHED_OUTPUT=KNOWLEDGE/"pages-enriched"
VISUAL_INDEX=KNOWLEDGE/"page-visual-index.jsonl"
PAGE_STATE=KNOWLEDGE/"page-state"
CHECKPOINT=KNOWLEDGE/"ocr-checkpoint.json"
OCR_LANGS={"9e05baa19a03":"ita+eng","8f82f1798f14":"ara+eng","0b057ed28a5f":"eng+por"}
PATTERN_TERMS=re.compile(r"باترون|البترون|قالب|pattern|moldes?|molde|cartamodello|patronagem|patronaje",re.I)
MEASURE_TERMS=re.compile(r"قياس|مقاس|جدول المقاسات|صدر|خصر|ورك|busto|cintura|quadril|measurements?|size chart|tamanho",re.I)
MODEL_TERMS=re.compile(r"موديل|تصميم|modelo|design|croqui|silhouette|look",re.I)
SEWING_TERMS=re.compile(r"خياطة|درزة|تشطيب|costura|costure|seam|stitch|acabamento",re.I)
DIMENSION_RE=re.compile(r"(?<!\w)\d+(?:[.,]\d+)?\s*(?:cm|mm|inches?|inch|سم|مم|بوصة)\b",re.I)

def run(args, timeout=180):
    return subprocess.run(args,check=True,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=timeout)

def read_jsonl(path):
    if not path.exists(): return []
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

def write_jsonl(path,records):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("w",encoding="utf-8") as f:
        for record in records: f.write(json.dumps(record,ensure_ascii=False)+"\n")

def append_jsonl(path,record):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("a",encoding="utf-8") as f:
        f.write(json.dumps(record,ensure_ascii=False)+"\n")

def atomic_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+".tmp")
    with temp.open("w",encoding="utf-8") as f:
        json.dump(data,f,ensure_ascii=False,indent=2)
        f.write("\n")
    temp.replace(path)

def page_state_path(book_id,page):
    return PAGE_STATE/book_id/f"{page:05d}.json"

def image_inventory(pdf):
    result=run(["pdfimages","-list",str(pdf)]).stdout
    pages=defaultdict(list)
    for line in result.splitlines():
        m=re.match(r"^\s*(\d+)\s+\d+\s+\S+\s+(\d+)\s+(\d+)\s+",line)
        if m:
            page,width,height=map(int,m.groups())
            pages[page].append({"width_px":width,"height_px":height})
    return pages

def ocr_page(pdf,page,language,dpi,temp_dir):
    prefix=temp_dir/f"page-{page}"
    run(["pdftoppm","-f",str(page),"-l",str(page),"-r",str(dpi),"-png","-singlefile",str(pdf),str(prefix)])
    image=Path(str(prefix)+".png")
    try:
        result=run(["tesseract",str(image),"stdout","-l",language,"--psm","3","tsv"]).stdout
        rows=csv.DictReader(result.splitlines(),delimiter="\t")
        words,confidences=[],[]
        for row in rows:
            word=(row.get("text") or "").strip()
            if word:
                words.append(word)
                try:
                    c=float(row.get("conf","-1"))
                    if c>=0: confidences.append(c)
                except (TypeError,ValueError): pass
        confidence=round(sum(confidences)/len(confidences),1) if confidences else None
        return " ".join(words),confidence
    finally:
        image.unlink(missing_ok=True)

def topics_for(text):
    tags=[]
    for pattern,tag in ((PATTERN_TERMS,"patternmaking_candidate"),(MEASURE_TERMS,"measurements_candidate"),(MODEL_TERMS,"garment_model_candidate"),(SEWING_TERMS,"construction_candidate")):
        if pattern.search(text): tags.append(tag)
    return tags

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--ocr-book-ids",default="")
    p.add_argument("--ocr-threshold",type=int,default=45)
    p.add_argument("--dpi",type=int,default=180)
    p.add_argument("--workers",type=int,default=3,help="Parallel OCR pages per book; keep low to limit RAM use")
    args=p.parse_args()
    selected={x.strip() for x in args.ocr_book_ids.split(",") if x.strip()}
    with CATALOG.open(encoding="utf-8") as f: books=json.load(f)["books"]
    report={"schema_version":"1.1.0","source_catalog":"catalog/books.json","method":"Poppler text + pdfimages inventory + selective Tesseract OCR","ocr_threshold_characters":args.ocr_threshold,"ocr_dpi":args.dpi,"books":[],"totals":{"pdf_books":0,"pages_indexed":0,"pages_with_embedded_images":0,"likely_full_page_scans":0,"pages_ocr_attempted":0,"pages_ocr_with_text":0,"errors":0}}
    visual_records=[]
    # Per-page state is a local runner checkpoint only; it does not survive a fresh GitHub-hosted runner.
    PAGE_STATE.mkdir(parents=True,exist_ok=True)
    checkpoint={"schema_version":"1.0.0","ocr_completed":{}}
    if CHECKPOINT.exists():
        try:
            checkpoint=json.loads(CHECKPOINT.read_text(encoding="utf-8"))
        except (OSError,json.JSONDecodeError):
            pass
    checkpoint.setdefault("ocr_completed",{})
    for book in books:
        if book.get("format")!="pdf": continue
        report["totals"]["pdf_books"]+=1
        pdf=BASE/book["path"]; book_id=book["id"]
        entry={"book_id":book_id,"title":book["title"],"source_path":str(pdf),"status":"pending","pages":0,"pages_with_text":0,"pages_with_images":0,"ocr_pages_attempted":0,"error":None}
        try:
            if not pdf.exists(): raise FileNotFoundError(f"PDF missing; check LFS checkout: {pdf}")
            page_records=read_jsonl(PAGE_TEXT/f"{book_id}.jsonl")
            if not page_records: raise RuntimeError("Missing page text JSONL; run extract_pages.py first")
            images=image_inventory(pdf); enriched=[]
            ocr_path=OCR_OUTPUT/f"{book_id}.jsonl"
            ocr_records=read_jsonl(ocr_path)
            # Resume safely by reusing OCR for the same page, language, DPI and PSM.
            # Legacy records from this pipeline used 180 DPI and PSM 3.
            existing_ocr={
                (int(x["page"]), x.get("language_model"), int(x.get("dpi",180)), int(x.get("psm",3))): x
                for x in ocr_records if x.get("page") is not None
            }
            # Checkpoint is an additional recovery source if the JSONL append was interrupted.
            for key,value in checkpoint["ocr_completed"].items():
                if value.get("book_id")==book_id:
                    existing_ocr[(int(value["page"]),value.get("language_model"),int(value.get("dpi",180)),int(value.get("psm",3)))]=value
            language=OCR_LANGS.get(book_id) if book_id in selected else None
            if "*" in selected:
                sample_text = " ".join((x.get("text") or "") for x in page_records[:30])
                has_arabic = bool(re.search(r"[\u0600-\u06ff]", sample_text))
                language = "ara+eng" if has_arabic else "eng+por+ita"
            with tempfile.TemporaryDirectory(prefix="fashion-ocr-") as tmp:
                temp_dir=Path(tmp)
                # Build only uncached OCR jobs; cached pages do not consume workers.
                jobs=[]
                for item in page_records:
                    page=int(item["page"]); original=(item.get("text") or "").strip()
                    # OCR only sparse-text pages that actually contain embedded page imagery.
                    # This avoids rasterizing blank/vector-only pages unnecessarily.
                    if not (language and len(original)<args.ocr_threshold and images.get(page)): continue
                    cache_key=(page,language,args.dpi,3)
                    if cache_key not in existing_ocr: jobs.append((page,language,args.dpi))
                def run_ocr_job(job):
                    page,lang,dpi=job
                    try:
                        text,confidence=ocr_page(pdf,page,lang,dpi,temp_dir)
                        return page,lang,dpi,text,confidence,"completed"
                    except subprocess.TimeoutExpired:
                        print(f"WARNING: OCR timed out for {book_id} page {page}; continuing.",file=sys.stderr)
                        return page,lang,dpi,"",None,"timed_out"
                if jobs:
                    with ThreadPoolExecutor(max_workers=max(1,args.workers)) as pool:
                        futures=[pool.submit(run_ocr_job,job) for job in jobs]
                        for future in as_completed(futures):
                            page,lang,dpi,ocr_text,confidence,ocr_status=future.result()
                            entry["ocr_pages_attempted"]+=1
                            report["totals"]["pages_ocr_attempted"]+=1
                            if ocr_text: report["totals"]["pages_ocr_with_text"]+=1
                            record={"book_id":book_id,"title":book["title"],"source_path":book["path"],"page":page,"language_model":lang,"dpi":dpi,"psm":3,"engine":"tesseract","ocr_text":ocr_text,"mean_word_confidence":confidence,"ocr_status":ocr_status,"review_status":"machine_extracted_unverified"}
                            ocr_records.append(record)
                            existing_ocr[(page,lang,dpi,3)]=record
                            # Append one completed page, avoiding a full JSONL rewrite per page.
                            append_jsonl(ocr_path,record)
                            checkpoint_key=f"{book_id}:{page}:{lang}:{dpi}:3"
                            checkpoint["ocr_completed"][checkpoint_key]=record
                            atomic_json(CHECKPOINT,checkpoint)
                # Rebuild enriched records in original PDF order, regardless of completion order.
                for item in page_records:
                    page=int(item["page"]); original=(item.get("text") or "").strip()
                    page_images=images.get(page,[]); ocr_text=""; confidence=None
                    should_ocr=bool(language and len(original)<args.ocr_threshold)
                    if should_ocr:
                        cached=existing_ocr.get((page,language,args.dpi,3))
                        if cached is not None:
                            ocr_text=cached.get("ocr_text","")
                            confidence=cached.get("mean_word_confidence")
                    combined="\n".join(x for x in (original,ocr_text) if x).strip()
                    topics=topics_for(combined)
                    enriched_record={"book_id":book_id,"title":book["title"],"source_path":book["path"],"page":page,"text":original,"ocr_text":ocr_text,"combined_text":combined,"ocr_language_model":language if should_ocr else None,"ocr_mean_word_confidence":confidence,"embedded_image_count":len(page_images),"embedded_image_dimensions":page_images,"candidate_topics":topics,"dimension_strings_unverified":DIMENSION_RE.findall(combined),"review_status":"machine_extracted_unverified"}
                    enriched.append(enriched_record)
                    full_scan=any(i["width_px"]>=1000 and i["height_px"]>=1000 for i in page_images)
                    visual_record={"book_id":book_id,"title":book["title"],"source_path":book["path"],"page":page,"text_characters":len(original),"ocr_characters":len(ocr_text),"embedded_image_count":len(page_images),"embedded_image_dimensions":page_images,"likely_full_page_scan":full_scan,"candidate_topics":topics,"review_status":"visual_review_required"}
                    visual_records.append(visual_record)
                    # Atomic local page checkpoint: useful within this runner workspace, but lost when the hosted runner is discarded.
                    atomic_json(page_state_path(book_id,page),{"schema_version":"1.0.0","book_id":book_id,"page":page,"enriched":enriched_record,"visual":visual_record,"status":"machine_extracted_unverified"})
            # Rebuild each book's aggregate files from local page checkpoints.
            durable=[]
            for state_file in sorted((PAGE_STATE/book_id).glob("*.json")):
                durable.append(json.loads(state_file.read_text(encoding="utf-8"))["enriched"])
            write_jsonl(ENRICHED_OUTPUT/f"{book_id}.jsonl",durable)
            # De-duplicate OCR rows by page/configuration before writing the canonical JSONL.
            unique_ocr={}
            for row in ocr_records:
                k=(int(row["page"]),row.get("language_model"),int(row.get("dpi",180)),int(row.get("psm",3)))
                unique_ocr[k]=row
            for k,row in existing_ocr.items(): unique_ocr[k]=row
            if unique_ocr: write_jsonl(ocr_path,[unique_ocr[k] for k in sorted(unique_ocr)])
            entry.update({"status":"complete","pages":len(page_records),"pages_with_text":sum(bool((x.get("text") or "").strip()) for x in page_records),"pages_with_images":sum(bool(images.get(int(x["page"]))) for x in page_records)})
            report["totals"]["pages_indexed"]+=len(page_records)
            report["totals"]["pages_with_embedded_images"]+=entry["pages_with_images"]
            report["totals"]["likely_full_page_scans"]+=sum(any(i["width_px"]>=1000 and i["height_px"]>=1000 for i in images.get(int(x["page"]),[])) for x in page_records)
            print(f"[{book_id}] {book['title']}: {entry['pages']} pages; {entry['pages_with_images']} with images; {entry['ocr_pages_attempted']} OCR")
        except Exception as e:
            entry["status"]="error"; entry["error"]=str(e); report["totals"]["errors"]+=1
            print(f"ERROR {book_id}: {e}",file=sys.stderr)
        report["books"].append(entry)
        # Persist a report checkpoint after every book, including failures.
        atomic_json(KNOWLEDGE/"visual-extraction-report.json",report)
    # Rebuild the visual index from local per-page state, eliminating duplicates within this runner.
    all_visual=[]
    for state_file in sorted(PAGE_STATE.glob("*/*.json")):
        try: all_visual.append(json.loads(state_file.read_text(encoding="utf-8"))["visual"])
        except (OSError,json.JSONDecodeError,KeyError): continue
    write_jsonl(VISUAL_INDEX,all_visual)
    KNOWLEDGE.mkdir(parents=True,exist_ok=True)
    atomic_json(KNOWLEDGE/"visual-extraction-report.json",report)
    print(json.dumps(report["totals"],ensure_ascii=False,indent=2))
    if report["totals"]["errors"]: sys.exit(1)

if __name__=="__main__": main()
