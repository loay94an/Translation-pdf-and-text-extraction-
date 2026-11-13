#!/usr/bin/env node
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HOST = '127.0.0.1';
const PORT = Number(process.env.LOCAL_AGENT_PORT || 8765);
const HOME = process.env.HOME || os.homedir();
const WORKSPACE = path.resolve(process.env.LOCAL_AGENT_WORKSPACE || path.join(HOME, 'workspace'));
const CONFIG_DIR = path.join(HOME, '.config', 'mobile-terminal-bridge');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token');
const GITHUB_TOKEN_FILE = path.join(CONFIG_DIR, 'github-token');
const BROWSER_CONTEXT_FILE = path.join(CONFIG_DIR, 'browser-context.json');
const MAX_BODY = 8 * 1024 * 1024;
const MAX_OUTPUT = 128 * 1024;
const TIMEOUT_MS = 120_000;
const JOBS_DIR = path.join(CONFIG_DIR, 'jobs');
const MAX_JOB_MS = 6 * 60 * 60 * 1000;
const MODEL_BASE_URL = (process.env.LOCAL_MODEL_BASE_URL || 'http://127.0.0.1:8080/v1').replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set((process.env.LOCAL_AGENT_ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));
const jobs = new Map();
fs.mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 });
function persistJob(job) {
  const snapshot = { id: job.id, command: job.command, cwd: job.cwd, status: job.status,
    exitCode: job.exitCode, startedAt: job.startedAt, finishedAt: job.finishedAt,
    timedOut: !!job.timedOut, progress: job.progress || null, logPath: job.logPath };
  fs.writeFileSync(path.join(JOBS_DIR, job.id + '.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
}
for (const name of fs.readdirSync(JOBS_DIR).filter(name => name.endsWith('.json'))) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, name), 'utf8'));
    if (!saved.id || !saved.command || !saved.logPath) continue;
    const output = fs.existsSync(saved.logPath) ? fs.readFileSync(saved.logPath, 'utf8').slice(-MAX_OUTPUT) : '';
    const job = { ...saved, output, child: null };
    if (job.status === 'running') { job.status = 'interrupted'; job.finishedAt = new Date().toISOString(); }
    jobs.set(job.id, job);
    persistJob(job);
  } catch {}
}

function originAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function startJob(command, cwd, timeoutMs) {
  if ([...jobs.values()].some(job => job.status === 'running' || job.status === 'cancelling')) throw new Error('هناك مهمة أخرى تعمل بالفعل؛ انتظر اكتمالها قبل بدء مهمة جديدة.');
  const id = crypto.randomUUID();
  const logPath = path.join(JOBS_DIR, id + '.log');
  const log = fs.createWriteStream(logPath, { flags: 'a', mode: 0o600 });
  const child = spawn('bash', ['-lc', command], { cwd, env: { ...process.env, TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const job = { id, command, cwd, status: 'running', exitCode: null, startedAt: new Date().toISOString(),
    finishedAt: null, output: '', logPath, child, progress: { stage: 'starting', completed: 0, total: 0, percent: 0 } };
  let pending = '';
  const append = (chunk, isError = false) => {
    pending += chunk.toString();
    const lines = pending.split(String.fromCharCode(10));
    pending = lines.pop() || '';
    for (let line of lines) {
      if (line.endsWith(String.fromCharCode(13))) line = line.slice(0, -1);
      if (line.startsWith('@@PROGRESS ')) {
        try { job.progress = JSON.parse(line.slice(11)); persistJob(job); } catch {}
      } else {
        const value = (isError ? '[stderr] ' : '') + line + String.fromCharCode(10);
        log.write(value);
        job.output = (job.output + value).slice(-MAX_OUTPUT);
      }
    }
  };
  child.stdout.on('data', chunk => append(chunk));
  child.stderr.on('data', chunk => append(chunk, true));
  const timer = setTimeout(() => {
    job.timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => { if (job.status === 'running' || job.status === 'cancelling') child.kill('SIGKILL'); }, 5000).unref();
  }, Math.min(Math.max(timeoutMs || TIMEOUT_MS, 1000), MAX_JOB_MS));
  child.on('error', error => {
    job.status = 'failed'; job.exitCode = 1; job.output = (job.output + String.fromCharCode(10) + error.message).slice(-MAX_OUTPUT);
    job.finishedAt = new Date().toISOString(); clearTimeout(timer); log.end(); persistJob(job);
  });
  child.on('close', code => {
    if (pending) append(Buffer.from(String.fromCharCode(10) + pending));
    job.status = job.timedOut ? 'timed_out' : (job.status === 'cancelling' ? 'cancelled' : (code === 0 ? 'completed' : 'failed'));
    job.exitCode = code; job.finishedAt = new Date().toISOString();
    clearTimeout(timer); log.end(); persistJob(job);
  });
  jobs.set(id, job);
  persistJob(job);
  return job;
}

fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
let token;
if (fs.existsSync(TOKEN_FILE)) token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
if (!token || token.length < 40) {
  token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
function authorized(req) {
  const value = req.headers.authorization || '';
  const supplied = value.startsWith('Bearer ') ? value.slice(7) : '';
  return supplied.length === token.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}
function resolveCwd(relative = '.') {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('cwd must be a relative path inside workspace');
  const target = path.resolve(WORKSPACE, relative);
  if (target !== WORKSPACE && !target.startsWith(WORKSPACE + path.sep)) throw new Error('cwd escapes the workspace');
  const real = fs.realpathSync(target);
  if (real !== WORKSPACE && !real.startsWith(WORKSPACE + path.sep)) throw new Error('cwd resolves outside workspace');
  if (!fs.statSync(real).isDirectory()) throw new Error('cwd is not a directory');
  return real;
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY) throw new Error('request body too large');
  }
  return JSON.parse(raw || '{}');
}

const server = http.createServer(async (req, res) => {
  const requestOrigin = req.headers.origin || '';
  if (!originAllowed(requestOrigin)) return send(res, 403, { ok: false, error: 'origin is not allowed; set LOCAL_AGENT_ALLOWED_ORIGINS to the exact website origin' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || 'null',
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
  }
  if (!authorized(req)) return send(res, 401, { ok: false, error: 'رمز الاتصال غير صحيح' });

  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'POST' && url.pathname === '/api/github/connect') {
    try {
      const body=await readBody(req); const ghToken=String(body.token||'').trim();
      if(!/^github_pat_[A-Za-z0-9_]+$/.test(ghToken)) return send(res,400,{ok:false,error:'صيغة رمز GitHub غير معروفة'});
      const response=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+ghToken,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)return send(res,401,{ok:false,error:data.message||'رفض GitHub الرمز أو صلاحياته'});
      fs.writeFileSync(GITHUB_TOKEN_FILE,ghToken+'\n',{mode:0o600});try{fs.chmodSync(GITHUB_TOKEN_FILE,0o600);}catch{}
      return send(res,200,{ok:true,login:data.login});
    }catch(error){return send(res,400,{ok:false,error:error.message||'تعذر ربط GitHub'});}
  }
  if (req.method === 'POST' && url.pathname === '/api/github/disconnect') {
    try{if(fs.existsSync(GITHUB_TOKEN_FILE))fs.unlinkSync(GITHUB_TOKEN_FILE);return send(res,200,{ok:true});}
    catch(error){return send(res,500,{ok:false,error:'تعذر حذف الرمز'});}
  }
  if (url.pathname.startsWith('/api/github/')) {
    const ghToken=fs.existsSync(GITHUB_TOKEN_FILE)?fs.readFileSync(GITHUB_TOKEN_FILE,'utf8').trim():'';
    if(!ghToken)return send(res,401,{ok:false,error:'اربط حساب GitHub أولًا'});
    const gh=async(apiPath,options={})=>{const response=await fetch('https://api.github.com'+apiPath,{...options,headers:{Authorization:'Bearer '+ghToken,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})},signal:AbortSignal.timeout(30000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||'GitHub API error '+response.status);return data;};
    try{
      if(req.method==='GET'&&url.pathname==='/api/github/repos'){
        const data=await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
        return send(res,200,{ok:true,repositories:data.map(r=>({full_name:r.full_name,private:r.private,default_branch:r.default_branch,permissions:r.permissions||{}}))});
      }

      if(req.method==='GET'&&url.pathname==='/api/github/read'){
        const repo=url.searchParams.get('repo')||'',branch=url.searchParams.get('branch')||'main',filePath=url.searchParams.get('path')||'';
        if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!filePath||filePath.startsWith('/')||filePath.split('/').some(p=>!p||p==='..'))throw new Error('المستودع أو مسار الملف غير صالح');
        const data=await gh('/repos/'+repo+'/contents/'+filePath.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(branch));
        if(Array.isArray(data)||data.type!=='file'||data.size>1024*1024)throw new Error('القراءة تدعم الملفات النصية حتى 1MB فقط');
        if(data.encoding!=='base64'||!data.content)throw new Error('تعذر فك ترميز الملف أو الملف ليس نصيًا');
        const content=Buffer.from(data.content.replace(/\n/g,''),'base64').toString('utf8');
        return send(res,200,{ok:true,path:data.path,sha:data.sha,size:data.size,content});
      }

      if(req.method==='GET'&&url.pathname==='/api/github/contents'){
        const repo=url.searchParams.get('repo')||'',branch=url.searchParams.get('branch')||'main',dir=url.searchParams.get('path')||'';
        if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new Error('اسم المستودع غير صالح');
        const data=await gh('/repos/'+repo+'/contents/'+dir.split('/').filter(Boolean).map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(branch));
        const items=(Array.isArray(data)?data:[data]).map(x=>({name:x.name,path:x.path,type:x.type,size:x.size,sha:x.sha}));
        return send(res,200,{ok:true,items});
      }
      if(req.method==='POST'&&url.pathname==='/api/github/upload'){
        const body=await readBody(req),repo=String(body.repo||''),branch=String(body.branch||'main'),filePath=String(body.path||''),b64=String(body.contentBase64||'');
        if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!filePath||filePath.startsWith('/')||filePath.split('/').some(p=>!p||p==='..'))throw new Error('بيانات المستودع أو مسار الملف غير صالح');
        if(!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)||Buffer.from(b64,'base64').length>5*1024*1024)throw new Error('حجم الملف أكبر من 5MB أو ترميز الملف غير صالح');
        let sha;try{const old=await gh('/repos/'+repo+'/contents/'+filePath.split('/').map(encodeURIComponent).join('/')+'?ref='+encodeURIComponent(branch));if(!Array.isArray(old))sha=old.sha;}catch{}
        const payload={message:String(body.message||'Upload from Control Center').slice(0,200),content:b64,branch,...(sha?{sha}:{})};
        const result=await gh('/repos/'+repo+'/contents/'+filePath.split('/').map(encodeURIComponent).join('/'),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        return send(res,200,{ok:true,commit:result.commit?.sha,path:filePath,url:result.content?.html_url});
      }
      if(req.method==='POST'&&url.pathname==='/api/github/delete'){
        const body=await readBody(req),repo=String(body.repo||''),branch=String(body.branch||'main'),filePath=String(body.path||''),sha=String(body.sha||'');
        if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!filePath||filePath.startsWith('/')||filePath.split('/').some(p=>!p||p==='..')||!sha)throw new Error('يلزم تحديد المستودع والمسار وSHA');
        const result=await gh('/repos/'+repo+'/contents/'+filePath.split('/').map(encodeURIComponent).join('/'),{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Delete '+filePath,sha,branch})});
        return send(res,200,{ok:true,commit:result.commit?.sha});
      }
      return send(res,404,{ok:false,error:'GitHub endpoint not found'});
    }catch(error){return send(res,400,{ok:false,error:error.message||'GitHub request failed'});}
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, platform: os.platform() + ' / ' + os.release(), workspace: WORKSPACE, jobs: jobs.size, activeJobs: [...jobs.values()].filter(job => job.status === 'running').length });
  }
  if (req.method === 'GET' && url.pathname === '/api/storage') {
    try {
      const stat = fs.statfsSync(WORKSPACE);
      const blockSize = Number(stat.bsize);
      const totalBytes = Number(stat.blocks) * blockSize;
      const freeBytes = Number(stat.bavail) * blockSize;
      return send(res, 200, { ok: true, workspace: WORKSPACE, totalBytes,
        freeBytes, usedBytes: Math.max(0, totalBytes - Number(stat.bfree) * blockSize) });
    } catch (error) {
      return send(res, 500, { ok: false, error: 'تعذر قراءة مساحة التخزين: ' + error.message });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/context') {
    try {
      const saved = fs.existsSync(BROWSER_CONTEXT_FILE) ? JSON.parse(fs.readFileSync(BROWSER_CONTEXT_FILE, 'utf8')) : { items: [] };
      return send(res, 200, { ok: true, items: Array.isArray(saved.items) ? saved.items.slice(-10) : [] });
    } catch (error) { return send(res, 500, { ok: false, error: 'تعذر قراءة سياق المتصفح المحفوظ' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/context') {
    try {
      const body = await readBody(req);
      if (typeof body.text !== 'string' || !body.text.trim()) return send(res, 400, { ok: false, error: 'text is required' });
      if (body.text.length > 24000) return send(res, 413, { ok: false, error: 'browser context exceeds 24,000 characters' });
      const saved = fs.existsSync(BROWSER_CONTEXT_FILE) ? JSON.parse(fs.readFileSync(BROWSER_CONTEXT_FILE, 'utf8')) : { items: [] };
      const item = { id: crypto.randomUUID(), source: String(body.source || 'browser').slice(0, 80), text: body.text.trim(), createdAt: new Date().toISOString() };
      const items = [...(Array.isArray(saved.items) ? saved.items : []), item].slice(-10);
      fs.writeFileSync(BROWSER_CONTEXT_FILE, JSON.stringify({ items }, null, 2), { mode: 0o600 });
      try { fs.chmodSync(BROWSER_CONTEXT_FILE, 0o600); } catch {}
      return send(res, 201, { ok: true, item: { id: item.id, source: item.source, createdAt: item.createdAt, characters: item.text.length }, count: items.length });
    } catch (error) { return send(res, 400, { ok: false, error: error.message || 'invalid browser context' }); }
  }
  if (req.method === 'DELETE' && url.pathname === '/api/context') {
    try { if (fs.existsSync(BROWSER_CONTEXT_FILE)) fs.unlinkSync(BROWSER_CONTEXT_FILE); return send(res, 200, { ok: true }); }
    catch (error) { return send(res, 500, { ok: false, error: 'تعذر مسح سياق المتصفح' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/providers') {
    const providers = [
      { id: 'local', label: 'النموذج المحلي', configured: true, endpoint: MODEL_BASE_URL },
    ];
    return send(res, 200, { ok: true, providers });
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    try {
      const body = await readBody(req);
      const provider = body.provider || 'local';
      if (provider !== 'local') return send(res, 400, { ok: false, error: 'هذا المسار محلي فقط؛ اربط ChatGPT عبر Sign in with ChatGPT الرسمي في تطبيق Android' });
      if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 40) return send(res, 400, { ok: false, error: 'messages must contain 1 to 40 entries' });
      const messages = body.messages.map(item => {
        if (!item || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 16000) throw new Error('invalid message; only system/user/assistant text messages are supported');
        return { role: item.role, content: item.content };
      });
      const totalChars = messages.reduce((sum, item) => sum + item.content.length, 0);
      if (totalChars > 48000) return send(res, 413, { ok: false, error: 'conversation is too large (48,000 characters maximum)' });
      const baseURL = MODEL_BASE_URL;
      const apiKey = process.env.LOCAL_MODEL_API_KEY || '';
      const model = body.model || process.env.LOCAL_MODEL_NAME || 'qwen-local';
      if (!baseURL || !model) return send(res, 503, { ok: false, error: 'النموذج المحلي غير مكتمل الإعداد' });
      let parsed;
      try { parsed = new URL(baseURL); } catch { return send(res, 400, { ok: false, error: 'invalid provider base URL' }); }
      if (!['http:', 'https:'].includes(parsed.protocol)) return send(res, 400, { ok: false, error: 'invalid local model URL protocol' });
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
      const response = await fetch(baseURL + '/chat/completions', {
        method: 'POST', headers,
        body: JSON.stringify({ model, messages, temperature: Number.isFinite(body.temperature) ? Math.min(Math.max(body.temperature, 0), 1.5) : 0.2, max_tokens: Number.isInteger(body.max_tokens) ? Math.min(Math.max(body.max_tokens, 1), 4096) : 512, stream: false }),
        signal: AbortSignal.timeout(120000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return send(res, 502, { ok: false, provider, status: response.status, error: data.error?.message || data.message || 'provider request failed' });
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return send(res, 502, { ok: false, provider, error: 'provider returned no text response' });
      return send(res, 200, { ok: true, provider: 'local', model, content, usage: data.usage || null });
    } catch (error) {
      return send(res, 400, { ok: false, error: error.message || 'invalid chat request' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/models') {
    try {
      const headers = {};
      if (process.env.LOCAL_MODEL_API_KEY) headers.Authorization = 'Bearer ' + process.env.LOCAL_MODEL_API_KEY;
      const response = await fetch(MODEL_BASE_URL + '/models', { headers, signal: AbortSignal.timeout(5000) });
      const data = await response.json().catch(() => ({}));
      return send(res, response.ok ? 200 : 502, { ok: response.ok, endpoint: MODEL_BASE_URL, status: response.status, models: data.data || [], error: response.ok ? undefined : (data.error?.message || 'model server returned an error') });
    } catch (error) {
      return send(res, 502, { ok: false, endpoint: MODEL_BASE_URL, error: error.message || 'local model is unreachable' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/extracted-pages') {
    try {
      const relative = url.searchParams.get('path') || '';
      if (!relative || path.isAbsolute(relative) || relative.includes('\\0')) throw new Error('path must be a relative JSONL path inside workspace');
      const target = path.resolve(WORKSPACE, relative);
      if (target !== WORKSPACE && !target.startsWith(WORKSPACE + path.sep)) throw new Error('path escapes workspace');
      const real = fs.realpathSync(target);
      if (!real.startsWith(WORKSPACE + path.sep) || !real.endsWith('.jsonl')) throw new Error('only JSONL files inside workspace are allowed');
      const stat = fs.statSync(real);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('file is missing or exceeds the 8MB preview limit');
      const lines = fs.readFileSync(real, 'utf8').split(/\\r?\\n/).filter(Boolean);
      if (lines.length > 2500) throw new Error('page count exceeds preview limit (2500)');
      const pages = lines.map((line, index) => {
        const item = JSON.parse(line);
        if (!Number.isInteger(item.page) || typeof item.text !== 'string') throw new Error('invalid page record at line ' + (index + 1));
        return { page: item.page, text: item.text };
      }).sort((a, b) => a.page - b.page);
      return send(res, 200, { ok: true, pages });
    } catch (error) {
      return send(res, 400, { ok: false, error: error.message || 'cannot read extracted pages' });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/jobs') {
    try {
      const body = await readBody(req);
      if (typeof body.command !== 'string' || !body.command.trim()) return send(res, 400, { ok: false, error: 'command is required' });
      if (body.command.length > 8000) return send(res, 413, { ok: false, error: 'command too long' });
      const cwd = resolveCwd(body.cwd || '.');
      const job = startJob(body.command, cwd, Number(body.timeoutMs) || MAX_JOB_MS);
      return send(res, 202, { ok: true, job: { id: job.id, status: job.status, startedAt: job.startedAt, cwd } });
    } catch (error) {
      return send(res, 400, { ok: false, error: error.message || 'invalid job request' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const items = [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 100)
      .map(job => ({ id: job.id, status: job.status, exitCode: job.exitCode, startedAt: job.startedAt,
        finishedAt: job.finishedAt, cwd: job.cwd, progress: job.progress || null }));
    return send(res, 200, { ok: true, jobs: items });
  }
  if (url.pathname.startsWith('/api/jobs/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts[2];
    const job = jobs.get(id);
    if (!job) return send(res, 404, { ok: false, error: 'job not found' });
    if (req.method === 'POST' && parts[3] === 'cancel') {
      if (job.status !== 'running' || !job.child) return send(res, 409, { ok: false, error: 'job is not running in this agent process' });
      job.status = 'cancelling'; persistJob(job); job.child.kill('SIGTERM');
      setTimeout(() => { if (job.child && job.status === 'cancelling') job.child.kill('SIGKILL'); }, 4000).unref();
      return send(res, 202, { ok: true, job: { id, status: job.status } });
    }
    if (req.method === 'POST' && parts[3] === 'retry') {
      if (!['failed', 'timed_out', 'interrupted'].includes(job.status)) return send(res, 409, { ok: false, error: 'only failed or interrupted jobs can be retried' });
      try {
        const cwd = resolveCwd(path.relative(WORKSPACE, job.cwd));
        const nextJob = startJob(job.command, cwd, MAX_JOB_MS);
        return send(res, 202, { ok: true, job: { id: nextJob.id, status: nextJob.status, startedAt: nextJob.startedAt, retryOf: id } });
      } catch (error) { return send(res, 409, { ok: false, error: error.message }); }
    }
    if (req.method === 'GET' && parts.length === 3) {
      return send(res, 200, { ok: true, job: { id: job.id, status: job.status, exitCode: job.exitCode,
        startedAt: job.startedAt, finishedAt: job.finishedAt, timedOut: !!job.timedOut, cwd: job.cwd,
        progress: job.progress || null, output: job.output, command: job.command } });
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/exec') {
    try {
      const body = await readBody(req);
      if (typeof body.command !== 'string' || !body.command.trim()) return send(res, 400, { ok: false, error: 'command is required' });
      if (body.command.length > 8000) return send(res, 413, { ok: false, error: 'command too long' });
      const cwd = resolveCwd(body.cwd || '.');
      const started = Date.now();
      try {
        const result = await execFileAsync('bash', ['-lc', body.command], {
          cwd,
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT,
          env: { ...process.env, TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' },
          windowsHide: true,
        });
        return send(res, 200, { ok: true, stdout: result.stdout, stderr: result.stderr, exitCode: 0, durationMs: Date.now() - started, cwd });
      } catch (error) {
        return send(res, 200, {
          ok: true,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message || 'command failed',
          exitCode: Number.isInteger(error.code) ? error.code : 1,
          durationMs: Date.now() - started,
          cwd,
        });
      }
    } catch (error) {
      return send(res, 400, { ok: false, error: error.message || 'invalid request' });
    }
  }
  return send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log('\n=== Mobile Terminal Bridge ===');
  console.log('Local URL: http://' + HOST + ':' + PORT);
  console.log('Workspace: ' + WORKSPACE);
  console.log('Token: ' + token);
  console.log('Keep this token private. Stop with Ctrl+C.\n');
});
server.on('error', error => { console.error(error); process.exit(1); });
