import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { runScript, type ScriptResponse, type ScriptTest } from './http-script.js';
import { ObjectError, type HttpVariable } from './model.js';

/** Variables defined in hive-am, per environment (see HttpConfig). */
type Hive = Record<string, Record<string, HttpVariable>> | undefined;

/**
 * HTTP requests as an object: a folder of `.http` / `.rest` files in the format of the IntelliJ and VS Code REST clients. hive-am lists the
 * requests of every file, picks an environment from `http-client.env.json` (and the private one next to it) and runs a request with `fetch`,
 * answering with the status, headers, body and time. No JDK and no extra package.
 *
 * Format that is understood: `###` separates requests (the text after it is the name; `# @name x` too); `@name = value` defines a variable;
 * `{{name}}` uses one (and `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`); the request line is `METHOD URL [HTTP/1.1]`
 * (lines that start with `?` or `&` continue the URL); header lines follow until the first blank line; the rest is the body (`< ./file`
 * inserts a file); `> {% … %}` response handlers are ignored.
 */
const MAX_DEPTH = 4, MAX_FILES = 300, MAX_REQUESTS = 2000;
const MAX_RESPONSE = 2 * 1024 * 1024, TIMEOUT_MS = 60_000, MAX_INCLUDE = 1024 * 1024;
const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.idea', '.vscode']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT']);
const ENV_FILES = ['http-client.env.json', 'http-client.private.env.json'];

export interface HttpRequestItem {
  id: string; index: number; name: string; method: string; url: string; headers: { name: string; value: string }[]; body?: string; line: number;
  /** The plain {{variables}} it uses. */ variables: string[];
  /** The requests whose answers it uses ({{login.response.body.token}} → "login"). */ refs: string[];
  /** Its name when the file gives one (`### name` or `# @name x`): the one other requests can refer to. */ named?: string;
  /** The response handler (`> {% … %}`), and a handler file it points to (`> file.js`, not run by hive-am). */ script?: string; scriptFile?: string;
}
export interface HttpFile { relFile: string; requests: HttpRequestItem[]; fileVariables: Record<string, string> }
export interface HttpScan { folder: string; files: HttpFile[]; environments: string[]; envFiles: string[]; /** Names of the variables the env files define, per environment (so the interface can say which of its own they override). */ fileVars: Record<string, string[]>; /** The variables that response handlers keep (client.global.set), and the requests that do it. */ setBy: Record<string, string[]>; /** Every {{variable}} the requests use (not the generated {{$…}} ones), with how many requests use each. */ used: { name: string; count: number }[]; /** The ones a file defines itself with `@name = value`. */ fileDefined: string[]; truncated: boolean }
export interface HttpRun {
  /** What the response handler did: tests, what it logged, the variables it kept, and why it could not run (if so). */
  tests: ScriptTest[]; logs: string[]; set: string[]; scriptError?: string; scriptFile?: string;
  request: { method: string; url: string; headers: { name: string; value: string }[]; body?: string };
  status: number; statusText: string; durationMs: number; size: number;
  headers: { name: string; value: string }[]; body: string; truncated: boolean; binary: boolean; contentType: string;
}

const VAR = /\{\{\s*([$A-Za-z0-9_.\[\]-]+)\s*\}\}/g;
const REF = /^([\w-]+)\.response\.(body|headers|status)(?:\.(.*))?$/;
const variablesIn = (...texts: (string | undefined)[]) => { const out = new Set<string>(); for (const t of texts) for (const m of (t ?? '').matchAll(VAR)) if (!REF.test(m[1])) out.add(m[1]); return [...out]; };
const refsIn = (...texts: (string | undefined)[]) => { const out = new Set<string>(); for (const t of texts) for (const m of (t ?? '').matchAll(VAR)) { const r = REF.exec(m[1]); if (r) out.add(r[1]); } return [...out]; };

/** One `.http` file → its requests. */
export function parseHttpFile(content: string, relFile: string): HttpFile {
  const lines = content.split(/\r?\n/);
  const fileVariables: Record<string, string> = {};
  const requests: HttpRequestItem[] = [];
  let name: string | undefined;
  let cur: { method: string; url: string; headers: { name: string; value: string }[]; body: string[]; line: number; inBody: boolean; name?: string } | null = null;

  const finish = () => {
    if (!cur) return;
    const body: string[] = []; let inHandler = false; const scripts: string[] = []; let current: string[] = []; let scriptFile: string | undefined;
    for (const l of cur.body) {
      const t = l.trim();
      if (!inHandler && (t.startsWith('> {%') || t.startsWith('>! {%'))) {
        const rest = t.replace(/^>!?\s*\{%/, '');
        if (rest.includes('%}')) { scripts.push(rest.slice(0, rest.lastIndexOf('%}'))); continue; }       // all in one line
        inHandler = true; current = rest.trim() ? [rest] : []; continue;
      }
      if (inHandler) { if (t.endsWith('%}')) { current.push(l.slice(0, l.lastIndexOf('%}'))); scripts.push(current.join('\n')); inHandler = false; } else current.push(l); continue; }
      if (t.startsWith('<> ')) continue;                                  // a saved response
      if (t.startsWith('> ')) { scriptFile = t.slice(2).trim(); continue; }  // a handler file
      body.push(l);
    }
    while (body.length && !body[body.length - 1].trim()) body.pop();
    while (body.length && !body[0].trim()) body.shift();
    const text = body.length ? body.join('\n') : undefined;
    const index = requests.length;
    requests.push({ id: `${relFile}#${index}`, index, name: cur.name || `${cur.method} ${cur.url.replace(/^(https?:\/\/[^/]+|\{\{[^}]+\}\})/, '').split('?')[0] || '/'}`, method: cur.method, url: cur.url, headers: cur.headers, body: text, line: cur.line, variables: variablesIn(cur.url, text, ...cur.headers.map((h) => h.value)), refs: refsIn(cur.url, text, ...cur.headers.map((h) => h.value)), named: /^[\w-]+$/.test(cur.name ?? '') ? cur.name : undefined, script: scripts.length ? scripts.join('\n') : undefined, scriptFile });
    cur = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd(), t = line.trim();
    if (/^#{3,}/.test(t)) { finish(); name = t.replace(/^#+\s*/, '').trim() || undefined; return; }
    if (cur?.inBody) { cur.body.push(raw); return; }
    const tag = /^(?:#|\/\/)\s*@name\s+(\S.*)$/.exec(t);
    if (tag) { name = tag[1].trim(); return; }
    if (!cur) {
      if (!t || t.startsWith('#') || t.startsWith('//')) return;
      const v = /^@([\w.-]+)\s*=\s*(.*)$/.exec(t);
      if (v) { fileVariables[v[1]] = v[2].trim(); return; }
      const m = /^([A-Za-z]+)\s+(\S.*?)(?:\s+HTTP\/[\d.]+)?$/.exec(t);
      if (m && METHODS.has(m[1].toUpperCase())) { cur = { method: m[1].toUpperCase(), url: m[2].trim(), headers: [], body: [], line: i + 1, inBody: false, name }; name = undefined; return; }
      if (/^https?:\/\//i.test(t)) { cur = { method: 'GET', url: t.replace(/\s+HTTP\/[\d.]+$/, ''), headers: [], body: [], line: i + 1, inBody: false, name }; name = undefined; }
      return;
    }
    if (!t) { cur.inBody = true; return; }                                       // the blank line that ends the headers
    if (!cur.headers.length && /^\s+[?&]/.test(line)) { cur.url += t; return; }  // an indented line continues the URL
    if (t.startsWith('#') || t.startsWith('//')) return;
    const h = /^([^\s:]+)\s*:\s*(.*)$/.exec(t);
    if (h) cur.headers.push({ name: h[1], value: h[2] });
    else cur.body.push(raw), cur.inBody = true;
  });
  finish();
  return { relFile, requests, fileVariables };
}

/** The folder, as a real path (so a link cannot lead outside of it). */
function realFolder(folder: string): string {
  if (!isAbsolute(folder)) throw new ObjectError('The folder must be an absolute path');
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new ObjectError(`The folder ${folder} does not exist`);
  return realpathSync(folder);
}
/** A path inside the folder, or an error. */
function inside(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (r.startsWith('..') || isAbsolute(r)) throw new ObjectError('That path is outside the folder');
  try { const real = realpathSync(abs); const rr = relative(root, real); if (rr.startsWith('..') || isAbsolute(rr)) throw new ObjectError('That path is outside the folder'); return real; } catch (e) { if (e instanceof ObjectError) throw e; return abs; }
}

const readJson = (file: string): Record<string, Record<string, unknown>> | null => {
  try { const j = JSON.parse(readFileSync(file, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
};

/** Environment variables for a file: the env files from the folder of the file up to the root (the nearest wins), the private one over the public one. */
function envVars(root: string, fileAbs: string, env: string | undefined, hive?: Hive): { vars: Record<string, string>; names: string[]; files: string[] } {
  const dirs: string[] = []; for (let d = dirname(fileAbs); ; d = dirname(d)) { dirs.push(d); if (d === root || !d.startsWith(root)) break; }
  const merged: Record<string, Record<string, unknown>> = {}; const files: string[] = [];
  for (const d of dirs.reverse()) for (const f of ENV_FILES) {
    const p = join(d, f); if (!existsSync(p)) continue;
    const j = readJson(p); if (!j) continue;
    files.push(relative(root, p));
    for (const [k, v] of Object.entries(j)) if (v && typeof v === 'object') merged[k] = { ...(merged[k] ?? {}), ...(v as Record<string, unknown>) };
  }
  const names = [...new Set([...Object.keys(merged), ...Object.keys(hive ?? {})])].filter((k) => k !== '$shared').sort();
  const vars: Record<string, string> = {};
  // hive-am's own variables fill in first; whatever an env file defines wins over them.
  for (const [k, v] of Object.entries({ ...(hive?.$shared ?? {}), ...(env ? hive?.[env] ?? {} : {}) })) vars[k] = v.value;
  for (const [k, v] of Object.entries({ ...(merged.$shared ?? {}), ...(env ? merged[env] ?? {} : {}) })) vars[k] = typeof v === 'string' ? v : JSON.stringify(v);
  return { vars, names, files };
}

export function scanHttp(folder: string, hive?: Hive): HttpScan {
  const root = realFolder(folder);
  const files: HttpFile[] = []; const envNames = new Set<string>(Object.keys(hive ?? {}).filter((k) => k !== '$shared')); const envFiles = new Set<string>(); const fileVars: Record<string, Set<string>> = {};
  let truncated = false, total = 0;
  const walk = (dir: string, depth: number) => {
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) { if (depth < MAX_DEPTH && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(abs, depth + 1); continue; }
      if (ENV_FILES.includes(e.name)) { envFiles.add(relative(root, abs)); for (const [k, vars] of Object.entries(readJson(abs) ?? {})) { if (k !== '$shared') envNames.add(k); const set = (fileVars[k] ??= new Set()); for (const name of Object.keys(vars ?? {})) set.add(name); } continue; }
      if (!/\.(http|rest)$/i.test(e.name)) continue;
      if (files.length >= MAX_FILES || total >= MAX_REQUESTS) { truncated = true; return; }
      try { const f = parseHttpFile(readFileSync(abs, 'utf8'), relative(root, abs)); if (f.requests.length) { files.push(f); total += f.requests.length; } } catch { /* unreadable file */ }
    }
  };
  walk(root, 0);
  const count = new Map<string, number>(); for (const f of files) for (const r of f.requests) for (const v of r.variables) if (!v.startsWith('$')) count.set(v, (count.get(v) ?? 0) + 1);
  const fileDefined = [...new Set(files.flatMap((f) => Object.keys(f.fileVariables)))].sort();
  // The variables that response handlers keep, found by reading the handlers (not by running them).
  const setBy: Record<string, string[]> = {};
  for (const f of files) for (const r of f.requests) for (const m of (r.script ?? '').matchAll(/client\.global\.set\(\s*["'`]([\w.-]+)["'`]/g)) (setBy[m[1]] ??= []).push(r.named ?? r.name);
  return { folder: root, setBy, files, environments: [...envNames].sort(), envFiles: [...envFiles].sort(), used: [...count].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), fileDefined, fileVars: Object.fromEntries(Object.entries(fileVars).map(([k, v]) => [k, [...v].sort()])), truncated };
}

const MASK = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token)$/i;
const mask = (name: string, value: string) => (MASK.test(name) ? `${value.slice(0, Math.min(6, Math.floor(value.length / 3)))}••••` : value);

const dynamic = (key: string): string | undefined => {
  if (key === '$uuid' || key === '$guid') return randomUUID();
  if (key === '$timestamp') return String(Math.floor(Date.now() / 1000));
  if (key === '$isoTimestamp') return new Date().toISOString();
  if (key === '$randomInt') return String(randomInt(0, 1000));
  return undefined;
};

/**
 * What lives while an HTTP object is used: the values its response handlers keep (`client.global.set`) and the last answer of each named
 * request (to write `{{login.response.body.token}}`). It is in memory: it ends when hive-am stops, and it can be looked at, changed and
 * cleared from the interface. These values win over the ones from environments and files, because something set them on purpose, later.
 */
export interface StoredResponse { status: number; headers: Record<string, string>; body: unknown; text: string; at: number }
export interface HttpSession { globals: Record<string, string>; responses: Map<string, StoredResponse> }
const sessions = new Map<string, HttpSession>();
export const sessionOf = (objectId: string): HttpSession => { let s = sessions.get(objectId); if (!s) sessions.set(objectId, s = { globals: {}, responses: new Map() }); return s; };
export const dropSession = (objectId: string) => { sessions.delete(objectId); };
export function sessionView(objectId: string) {
  const s = sessionOf(objectId);
  return { globals: { ...s.globals }, responses: [...s.responses].map(([name, r]) => ({ name, status: r.status, at: r.at })) };
}
export function sessionSet(objectId: string, name: string, value: string) {
  if (!/^[A-Za-z_][\w.-]{0,80}$/.test(name)) throw new ObjectError(`"${name}" is not a valid variable name`);
  if (value.length > 8000) throw new ObjectError('The value is too long');
  sessionOf(objectId).globals[name] = value;
}
/** Forgets one value, or (without a name) every value and every stored answer. */
export function sessionClear(objectId: string, name?: string) {
  const s = sessionOf(objectId);
  if (name) delete s.globals[name]; else { s.globals = {}; s.responses.clear(); }
}

/** `{{login.response.body.$.token}}`, `{{login.response.headers.X-Token}}`, `{{login.response.status}}`: a piece of the last answer of a named request. */
function fromResponse(s: HttpSession | undefined, key: string): string | undefined {
  const m = REF.exec(key); if (!m) return undefined;
  const r = s?.responses.get(m[1]); if (!r) return undefined;
  if (m[2] === 'status') return String(r.status);
  if (m[2] === 'headers') return r.headers[(m[3] ?? '').toLowerCase()];
  const path = (m[3] ?? '*').replace(/^\$\.?/, '');
  if (path === '*' || path === '') return r.text;
  let cur: unknown = r.body;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur === undefined ? undefined : typeof cur === 'string' ? cur : JSON.stringify(cur);
}

const substitute = (text: string, vars: Record<string, string>, unresolved: Set<string>, session?: HttpSession): string => {
  let out = text;
  for (let pass = 0; pass < 5 && VAR.test(out); pass++) { VAR.lastIndex = 0; out = out.replace(VAR, (whole, k: string) => dynamic(k) ?? vars[k] ?? fromResponse(session, k) ?? whole); }
  VAR.lastIndex = 0;
  for (const m of out.matchAll(VAR)) unresolved.add(m[1]);
  return out;
};

/** The variables a request needs and where each one stands, so the interface can show what is missing before running it. */
export function describeHttp(folder: string, relFile: string, index: number, env?: string, hive?: Hive, session?: HttpSession) {
  const root = realFolder(folder);
  const abs = inside(root, relFile);
  const file = parseHttpFile(readFileSync(abs, 'utf8'), relFile);
  const item = file.requests[index]; if (!item) throw new ObjectError(`Request #${index} is not in ${relFile}`);
  const e = envVars(root, abs, env, hive);
  const vars = { ...e.vars, ...file.fileVariables, ...(session?.globals ?? {}) };
  // Answers of other requests this one uses: a reference to a request that has not been run in this session is missing too.
  const refMissing = [...(item.url + (item.body ?? '') + item.headers.map((x) => x.value).join('\n')).matchAll(VAR)].map((m) => m[1]).filter((k) => REF.test(k) && fromResponse(session, k) === undefined);
  const missing = [...item.variables.filter((v) => dynamic(v) === undefined && !(v in vars)), ...new Set(refMissing)];
  return { item, missing, needsRun: [...new Set(refMissing.map((k) => REF.exec(k)![1]))], environments: e.names };
}

export async function runHttp(folder: string, relFile: string, index: number, env?: string, hive?: Hive, session: HttpSession = { globals: {}, responses: new Map() }): Promise<HttpRun> {
  const root = realFolder(folder);
  const abs = inside(root, relFile);
  if (!/\.(http|rest)$/i.test(abs)) throw new ObjectError('That is not a .http file');
  const file = parseHttpFile(readFileSync(abs, 'utf8'), relFile);
  const item = file.requests[index]; if (!item) throw new ObjectError(`Request #${index} is not in ${relFile}`);
  const e = envVars(root, abs, env, hive);
  if (env && !e.names.includes(env)) throw new ObjectError(`The environment "${env}" is not in the env files`);
  const vars = { ...e.vars, ...file.fileVariables, ...session.globals };
  const unresolved = new Set<string>();
  const url = substitute(item.url, vars, unresolved, session);
  const headers = item.headers.map((h) => ({ name: h.name, value: substitute(h.value, vars, unresolved, session) }));
  let body = item.body === undefined ? undefined : substitute(item.body, vars, unresolved, session);
  const needRun = [...new Set([...unresolved].filter((k) => REF.test(k)).map((k) => REF.exec(k)![1]))];
  if (needRun.length) throw new ObjectError(`This request uses the answer of ${needRun.map((n) => `“${n}”`).join(', ')}, which has not been run in this session: run ${needRun.length > 1 ? 'them' : 'it'} first (or the whole file, in order).`);
  if (unresolved.size) throw new ObjectError(`Missing values for: ${[...unresolved].map((v) => `{{${v}}}`).join(', ')}${e.names.length ? '. Pick an environment that defines them.' : '. Define them in the file (@name = value), in an http-client.env.json, or in the Variables of this object.'}`);

  // `< ./file` as the whole body: the content of a file next to the .http file (inside the folder).
  const inc = body && /^<\s+(\S+)\s*$/.exec(body.trim());
  if (inc) { const p = inside(root, join(relative(root, dirname(abs)), inc[1])); if (statSync(p).size > MAX_INCLUDE) throw new ObjectError('The included file is too large'); body = readFileSync(p, 'utf8'); }

  let target: URL;
  try { target = new URL(url); } catch { throw new ObjectError(`"${url}" is not a full URL: use http:// or https://, or define a {{host}} variable`); }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new ObjectError('Only http and https URLs can be requested');
  const hasBody = body !== undefined && !['GET', 'HEAD'].includes(item.method);

  const started = Date.now(), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, { method: item.method, headers: Object.fromEntries(headers.map((h) => [h.name, h.value])), body: hasBody ? body : undefined, signal: ctl.signal, redirect: 'follow' });
    const buf = Buffer.from(await res.arrayBuffer());
    const durationMs = Date.now() - started;
    const contentType = res.headers.get('content-type') ?? '';
    const binary = buf.subarray(0, 4000).includes(0) || /^(image|audio|video)\//.test(contentType) || /octet-stream|zip|pdf/.test(contentType);
    const truncated = buf.length > MAX_RESPONSE;
    const text = binary ? '' : buf.subarray(0, MAX_RESPONSE).toString('utf8');
    // The answer, as the handlers and the other requests see it: JSON when it is JSON.
    let parsed: unknown = text;
    if (!binary && (/json/i.test(contentType) || /^\s*[[{]/.test(text))) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    const lower = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    if (item.named) session.responses.set(item.named, { status: res.status, headers: lower, body: parsed, text, at: Date.now() });
    const handled = item.script ? runScript(item.script, { status: res.status, headers: lower, body: parsed, text, contentType } as ScriptResponse, session.globals) : null;
    return {
      tests: handled?.tests ?? [], logs: handled?.logs ?? [], set: handled?.set ?? [], scriptError: handled?.error, scriptFile: item.scriptFile,
      request: { method: item.method, url: target.toString(), headers: headers.map((h) => ({ name: h.name, value: mask(h.name, h.value) })), body: hasBody ? body : undefined },
      status: res.status, statusText: res.statusText, durationMs, size: buf.length,
      headers: [...res.headers.entries()].map(([name, value]) => ({ name, value })),
      body: text, truncated, binary, contentType,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ObjectError(`The request took more than ${TIMEOUT_MS / 1000} s and was cancelled`);
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new ObjectError(`The request failed: ${cause?.code ? `${cause.code} (${cause.message ?? ''})` : (err as Error).message}`.slice(0, 300));
  } finally { clearTimeout(timer); }
}

export const httpCount = (folder: string): number => { try { return scanHttp(folder).files.reduce((n, f) => n + f.requests.length, 0); } catch { return 0; } };
