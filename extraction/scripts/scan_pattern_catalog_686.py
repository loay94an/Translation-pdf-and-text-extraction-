#!/usr/bin/env python3
"""Resumable parallel extraction for the 686-pattern PDF collection."""
import argparse, hashlib, json, os, re, subprocess, tempfile, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("assets/fashion-model-library")
SOURCE = ROOT / "patterns/marlene-mukai"
OUT = ROOT / "pattern-library"
CATALOG, PROGRESS, REPORT = OUT/"pattern-catalog.jsonl", OUT/"pattern-progress.json", OUT/"pattern-extraction-report.json"
LOCK = threading.Lock()
OCR_GATE = threading.Semaphore(4)
FABRICS = ["malha","tecido plano","jeans","denim","tricoline","viscose","lycra","elastano","cotton","knit","woven","jersey","stretch"]
PIECES = ["frente","costas","manga","gola","bolso","cós","punho","collar","sleeve","front","back","pocket","waistband","cuff"]
STRETCH = ["elasticidade","elastano","lycra","malha","stretch","elastic"]

def sha256_file(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
    return h.hexdigest()

def atomic_write(path, content):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(content,encoding="utf-8")
    os.replace(tmp,path)

def load_existing():
    out={}
    if CATALOG.exists():
        for line in CATALOG.read_text(encoding="utf-8").splitlines():
            try:
                x=json.loads(line); out[x["source_path"]]=x
            except (ValueError,KeyError): pass
    return out

def title_from_path(rel):
    stem=Path(rel).stem
    stem=re.sub(r"_[0-9a-fA-F]{8}$","",stem)
    if "_" in stem:
        prefix,rest=stem.split("_",1)
        if len(prefix)<35: stem=rest
    return re.sub(r"\s+"," ",stem).strip()

def get_pages(path):
    p=subprocess.run(["pdfinfo",str(path)],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=90)
    if p.returncode: raise RuntimeError("pdfinfo: "+p.stderr.strip())
    m=re.search(r"^Pages:\s+(\d+)",p.stdout,re.M)
    if not m: raise RuntimeError("PDF page count unavailable")
    n=int(m.group(1))
    p=subprocess.run(["pdftotext","-layout","-enc","UTF-8",str(path),"-"],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=300)
    if p.returncode: raise RuntimeError("pdftotext: "+p.stderr.strip())
    pages=p.stdout.split("\f")
    pages=(pages+[""]*n)[:n]
    return n,[x.strip() for x in pages]

def ocr_page(path,n,tmp):
    prefix=Path(tmp)/("page-"+str(n))
    with OCR_GATE:
        r=subprocess.run(["pdftoppm","-f",str(n),"-l",str(n),"-r","160","-png","-singlefile",str(path),str(prefix)],capture_output=True,text=True,timeout=180)
        img=Path(str(prefix)+".png")
        if r.returncode or not img.exists(): return "","render_failed"
        r=subprocess.run(["tesseract",str(img),"stdout","-l","por+eng","--psm","6"],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=180)
        if r.returncode: return "","ocr_failed"
        return r.stdout.strip(),"ocr"

def detect(text):
    low=text.lower()
    measures=re.findall(r"(?<!\w)\d{1,3}(?:[.,]\d{1,2})?\s*(?:cm|mm|m|inches|inch|pol(?:\.|egadas?)?)\b",text,re.I)
    sizes=sorted(set(re.findall(r"(?<!\w)(?:XXS|XS|S|M|L|XL|XXL|XXXL|PP|P|G|GG|EG)(?=\W|$)",text,re.I)))
    seam=re.findall(r"(?:margem de costura|seam allowance)\s*[:\-]?\s*\d{1,3}(?:[.,]\d+)?\s*(?:cm|mm|in)?",text,re.I)
    scale=re.findall(r"(?:escala|scale)\s*[:\-]?\s*1\s*[:/]\s*\d+",text,re.I)
    return {
      "measurement_tokens":list(dict.fromkeys(measures))[:40],
      "size_labels":sizes[:30],
      "fabric_terms":sorted(x for x in FABRICS if x in low),
      "pattern_piece_terms":sorted(x for x in PIECES if x in low),
      "stretch_terms":sorted(x for x in STRETCH if x in low),
      "seam_allowance_mentions":list(dict.fromkeys(seam))[:20],
      "scale_mentions":list(dict.fromkeys(scale))[:10]
    }

def inspect(path,rel,digest):
    count,pages=get_pages(path)
    methods=[]; ocr_count=0; ocr_errors=0
    with tempfile.TemporaryDirectory(prefix="pattern-ocr-") as tmp:
        for i,txt in enumerate(pages,1):
            method="embedded_text"
            if len(txt)<45:
                extracted,status=ocr_page(path,i,tmp)
                if status=="ocr":
                    txt=extracted; pages[i-1]=txt; ocr_count+=1; method="tesseract_por_eng"
                else:
                    method=status
                    if status=="ocr_failed": ocr_errors+=1
            methods.append({"page":i,"method":method,"text_chars":len(txt)})
    imgs=set()
    r=subprocess.run(["pdfimages","-list",str(path)],capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=180)
    if r.returncode==0:
        for line in r.stdout.splitlines():
            a=line.split()
            if len(a)>=5 and a[0].isdigit() and a[1].isdigit(): imgs.add(int(a[0]))
    text="\n".join(pages)
    return {
      "book_id":hashlib.sha256(rel.encode()).hexdigest()[:16],
      "title":title_from_path(rel),"category":Path(rel).parent.name,
      "source_path":rel,"source_sha256":digest,"format":"pdf","status":"complete",
      "page_count":count,"pages_with_embedded_images":len(imgs),
      "ocr_pages":ocr_count,"ocr_errors":ocr_errors,
      "extracted_text_chars":len(text),"page_methods":methods,
      "detected":detect(text),
      "text_sha256":hashlib.sha256(text.encode()).hexdigest(),
      "review_status":"machine_extracted_needs_human_visual_validation",
      "geometry_status":"not_yet_digitized","rights_status":"unknown"
    }

def persist(records,expected,discovered,unique,duplicates):
    rows=sorted(records.values(),key=lambda x:x["source_path"])
    atomic_write(CATALOG,"".join(json.dumps(x,ensure_ascii=False)+"\n" for x in rows))
    counts={}
    for x in rows: counts[x.get("status","unknown")]=counts.get(x.get("status","unknown"),0)+1
    progress={"updated_at":datetime.now(timezone.utc).isoformat(),"expected_unique_books":expected,
      "files_discovered":discovered,"unique_source_files":unique,"duplicates":duplicates,
      "completed":counts.get("complete",0),"failed":counts.get("failed",0),
      "records_written":len(rows),"status_counts":counts}
    atomic_write(PROGRESS,json.dumps(progress,ensure_ascii=False,indent=2)+"\n")
    return progress

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--workers",type=int,default=12)
    p.add_argument("--expected-books",type=int,default=686)
    a=p.parse_args()
    if not 1<=a.workers<=16: p.error("--workers must be between 1 and 16 to avoid runner CPU and memory contention")
    files=sorted(SOURCE.rglob("*.pdf"))
    if not files: raise SystemExit("No PDFs found; check checkout and Git LFS")
    old=load_existing(); hashed={}; by_hash={}
    for path in files:
        rel=path.relative_to(ROOT).as_posix()
        try:
            digest=sha256_file(path); hashed[rel]=(path,digest); by_hash.setdefault(digest,[]).append(rel)
        except OSError as e: hashed[rel]=(path,None,str(e))
    unique=[]; records={}; dup_count=0
    for digest,paths in by_hash.items():
        paths.sort(); rel=paths[0]; unique.append((rel,hashed[rel][0],digest))
        for dup in paths[1:]:
            dup_count+=1
            records[dup]={"book_id":hashlib.sha256(dup.encode()).hexdigest()[:16],"title":title_from_path(dup),
              "category":Path(dup).parent.name,"source_path":dup,"source_sha256":digest,
              "format":"pdf","status":"duplicate","duplicate_of":rel,"review_status":"exact_sha256_duplicate"}
    for rel,item in hashed.items():
        if item[1] is None:
            records[rel]={"book_id":hashlib.sha256(rel.encode()).hexdigest()[:16],"title":title_from_path(rel),
              "category":Path(rel).parent.name,"source_path":rel,"status":"failed","error":item[2]}
    pending=[]
    for rel,path,digest in unique:
        prev=old.get(rel)
        if prev and prev.get("source_sha256")==digest and prev.get("status")=="complete": records[rel]=prev
        else: pending.append((rel,path,digest))
    OUT.mkdir(parents=True,exist_ok=True)
    print(json.dumps({"files_discovered":len(files),"unique_files":len(unique),"duplicates":dup_count,
      "pending":len(pending),"workers":a.workers,"ocr_parallel_limit":4}),flush=True)
    completed_since_checkpoint=0
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        futures={pool.submit(inspect,path,rel,digest):rel for rel,path,digest in pending}
        for f in as_completed(futures):
            rel=futures[f]
            try:
                records[rel]=f.result(); print("OK "+rel,flush=True)
            except Exception as e:
                records[rel]={"book_id":hashlib.sha256(rel.encode()).hexdigest()[:16],"title":title_from_path(rel),
                  "category":Path(rel).parent.name,"source_path":rel,
                  "source_sha256":next((d for r,_,d in unique if r==rel),None),
                  "status":"failed","error":str(e)}
                print("ERROR "+rel+": "+str(e),flush=True)
            with LOCK:
                completed_since_checkpoint += 1
                # Avoid rewriting the growing catalog after every PDF; checkpoint every 10 files.
                if completed_since_checkpoint % 10 == 0:
                    persist(records,a.expected_books,len(files),len(unique),dup_count)
    progress=persist(records,a.expected_books,len(files),len(unique),dup_count)
    rows=sorted(records.values(),key=lambda x:x["source_path"])
    report={"schema_version":"1.0.0","pipeline":"parallel_686_pattern_catalog",
      "updated_at":datetime.now(timezone.utc).isoformat(),"expected_unique_books":a.expected_books,
      "files_discovered":len(files),"unique_source_files":len(unique),"duplicates":dup_count,
      "books_completed":sum(x.get("status")=="complete" for x in rows),
      "books_failed":sum(x.get("status")=="failed" for x in rows),
      "pages_total":sum(x.get("page_count",0) for x in rows),
      "ocr_pages":sum(x.get("ocr_pages",0) for x in rows),
      "workers":a.workers,"ocr_parallel_limit":4,"progress":progress,
      "category_counts":{},"records_path":str(CATALOG.relative_to(ROOT))}
    for x in rows:
        c=x.get("category","unknown"); report["category_counts"][c]=report["category_counts"].get(c,0)+1
    atomic_write(REPORT,json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(report,ensure_ascii=False),flush=True)
    if report["books_failed"] or len(unique)!=a.expected_books: raise SystemExit(1)

if __name__=="__main__": main()

# workflow version bump: use corrected branch ref expressions
