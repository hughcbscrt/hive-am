/** Text helpers for .http files: requests as text, a pasted cURL command as a request, and changes to one request inside a file. */

export interface DraftRequest { name: string; method: string; url: string; headers: { name: string; value: string }[]; body: string }

/** The text of one request, ready to put in a file. */
export function requestBlock(r: DraftRequest): string {
  const lines = [`### ${r.name.trim() || `${r.method} request`}`, `${r.method} ${r.url.trim()}`, ...r.headers.filter((h) => h.name.trim()).map((h) => `${h.name.trim()}: ${h.value}`)];
  if (r.body.trim()) lines.push('', r.body.replace(/\s+$/, ''));
  return lines.join('\n');
}
/** Adds a request at the end of a file (after a blank line). */
export function appendRequest(content: string, r: DraftRequest): string {
  const base = content.replace(/\s+$/, '');
  return `${base}${base ? '\n\n' : ''}${requestBlock(r)}\n`;
}

/** Splits a shell command into words, the way a shell would (quotes, backslashes, line continuations). */
function shellWords(cmd: string): string[] {
  const out: string[] = []; let cur = ''; let has = false;
  const s = cmd.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { has = true; const e = s.indexOf("'", i + 1); const end = e < 0 ? s.length : e; cur += s.slice(i + 1, end); i = end; continue; }
    if (c === '"') { has = true; i++; for (; i < s.length && s[i] !== '"'; i++) { if (s[i] === '\\' && i + 1 < s.length && /["\\$`]/.test(s[i + 1])) i++; cur += s[i]; } continue; }
    if (c === '$' && s[i + 1] === "'") { has = true; i += 2; for (; i < s.length && s[i] !== "'"; i++) { if (s[i] === '\\' && i + 1 < s.length) { i++; const m: Record<string, string> = { n: '\n', t: '\t', r: '\r', "'": "'", '\\': '\\' }; cur += m[s[i]] ?? s[i]; } else cur += s[i]; } continue; }
    if (c === '\\' && i + 1 < s.length) { has = true; cur += s[++i]; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    has = true; cur += c;
  }
  if (has) out.push(cur);
  return out;
}

/** A cURL command (as copied from a browser, a doc or another tool) as a request. Throws a message when there is no URL. */
export function parseCurl(cmd: string): DraftRequest {
  const w = shellWords(cmd.trim());
  if (w[0] === 'curl') w.shift();
  let method = '', url = '', body: string | undefined; const headers: { name: string; value: string }[] = [];
  const data: string[] = []; let user = '', form = false, get = false;
  for (let i = 0; i < w.length; i++) {
    const a = w[i]; const next = () => w[++i] ?? '';
    const inline = /^(--[\w-]+)=(.*)$/s.exec(a);
    const opt = inline ? inline[1] : a; const val = (): string => (inline ? inline[2] : next());
    if (opt === '-X' || opt === '--request') method = val().toUpperCase();
    else if (opt === '-H' || opt === '--header') { const h = val(); const k = h.indexOf(':'); if (k > 0) headers.push({ name: h.slice(0, k).trim(), value: h.slice(k + 1).trim() }); }
    else if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode'].includes(opt)) data.push(val());
    else if (opt === '-u' || opt === '--user') user = val();
    else if (opt === '-b' || opt === '--cookie') headers.push({ name: 'Cookie', value: val() });
    else if (opt === '-A' || opt === '--user-agent') headers.push({ name: 'User-Agent', value: val() });
    else if (opt === '-e' || opt === '--referer') headers.push({ name: 'Referer', value: val() });
    else if (opt === '--url') url = val();
    else if (opt === '-F' || opt === '--form') { form = true; data.push(val()); }
    else if (opt === '-G' || opt === '--get') get = true;
    else if (opt === '-I' || opt === '--head') method = 'HEAD';
    else if (['-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '--proxy', '-x', '--cacert', '--cert', '--key', '-E'].includes(opt)) { if (!inline) next(); }
    else if (a.startsWith('-')) { /* a flag with no value we care about (-s, -L, -k, --compressed…) */ }
    else if (!url) url = a;
  }
  if (!url) throw new Error('No URL found in the command');
  if (data.length) body = data.join('&');
  if (user) headers.push({ name: 'Authorization', value: `Basic ${user.replace(':', ' ')}` });
  if (get && body) { url += (url.includes('?') ? '&' : '?') + body; body = undefined; }
  if (!method) method = body !== undefined && !form ? 'POST' : 'GET';
  if (form) throw new Error('multipart forms (-F) are not supported yet');
  let name = '';
  try { const u = new URL(url); name = `${method} ${u.pathname}`; } catch { name = `${method} request`; }
  if (body !== undefined && !headers.some((h) => h.name.toLowerCase() === 'content-type')) headers.push({ name: 'Content-Type', value: /^\s*[[{]/.test(body) ? 'application/json' : 'application/x-www-form-urlencoded' });
  return { name, method, url, headers, body: body ?? '' };
}

/** Where the headers of the request that starts at `line` (1-based) end: the index of the first line after them. */
function headerRange(lines: string[], line: number): { first: number; end: number } {
  let i = line; // the line after the request line
  while (i < lines.length && /^\s+[?&]/.test(lines[i])) i++;      // URL continuation lines
  const first = i;
  while (i < lines.length && lines[i].trim() && !/^#{3,}/.test(lines[i].trim())) i++;
  return { first, end: i };
}
/** Sets (or, with null, removes) a header of the request that starts at `line` (1-based). */
export function setRequestHeader(content: string, line: number, name: string, value: string | null): string {
  const lines = content.split('\n');
  const { first, end } = headerRange(lines, line);
  const idx = lines.slice(first, end).findIndex((l) => l.split(':')[0].trim().toLowerCase() === name.toLowerCase());
  if (idx >= 0) { if (value === null) lines.splice(first + idx, 1); else lines[first + idx] = `${name}: ${value}`; }
  else if (value !== null) lines.splice(end, 0, `${name}: ${value}`);
  return lines.join('\n');
}
/** The value of a header of the request that starts at `line`, if it has one. */
export function getRequestHeader(content: string, line: number, name: string): string | undefined {
  const lines = content.split('\n');
  const { first, end } = headerRange(lines, line);
  const l = lines.slice(first, end).find((x) => x.split(':')[0].trim().toLowerCase() === name.toLowerCase());
  return l === undefined ? undefined : l.slice(l.indexOf(':') + 1).trim();
}

// ------------------------------------------------------------------ assertions without code
/** One check on the answer, as the form shows it. It is saved in the file as a response handler (see `setAssertions`). */
export interface Assertion { k: 'status' | 'time' | 'header' | 'body' | 'text'; name?: string; op: string; v?: string }
export const ASSERT_OPS: Record<Assertion['k'], string[]> = {
  status: ['=', '!=', '2xx', '<', '>'], time: ['<', '>'], header: ['exists', '=', 'contains'], body: ['exists', '=', '!=', 'contains', '>', '<'], text: ['contains'],
};
const MARK = '// hive-am:asserts ';
const lit = (v: string): string => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : /^(true|false|null)$/.test(v.trim()) ? v.trim() : JSON.stringify(v));
/** `$.a.b[0]` or `a.b[0]` as an expression over `response.body`. */
export function bodyPath(path: string): string {
  const p = path.trim().replace(/^\$\.?/, '');
  let out = 'response.body';
  for (const m of p.matchAll(/\[(\d+)\]|\["([^"]+)"\]|\.?([^.[\]]+)/g)) out += m[1] !== undefined ? `[${m[1]}]` : /^[A-Za-z_]\w*$/.test(m[2] ?? m[3]) ? `.${m[2] ?? m[3]}` : `[${JSON.stringify(m[2] ?? m[3])}]`;
  return out;
}
/** The condition and a readable label of one assertion. */
export function assertCode(a: Assertion): { label: string; cond: string } {
  const v = a.v ?? '';
  if (a.k === 'status') return a.op === '2xx' ? { label: 'status is 2xx', cond: 'response.status >= 200 && response.status < 300' } : { label: `status ${a.op} ${v}`, cond: `response.status ${a.op === '=' ? '==' : a.op} ${lit(v)}` };
  if (a.k === 'time') return { label: `time ${a.op} ${v} ms`, cond: `response.time ${a.op} ${Number(v) || 0}` };
  if (a.k === 'header') {
    const h = `response.headers.valueOf(${JSON.stringify((a.name ?? '').toLowerCase())})`;
    return a.op === 'exists' ? { label: `header ${a.name} exists`, cond: `${h} !== undefined` } : a.op === 'contains' ? { label: `header ${a.name} contains ${v}`, cond: `${h} !== undefined && ${h}.includes(${JSON.stringify(v)})` } : { label: `header ${a.name} = ${v}`, cond: `${h} == ${lit(v)}` };
  }
  if (a.k === 'text') return { label: `answer contains ${v}`, cond: `response.text.includes(${JSON.stringify(v)})` };
  const e = bodyPath(a.name ?? '$');
  const nm = a.name ?? '$';
  return a.op === 'exists' ? { label: `${nm} exists`, cond: `${e} !== undefined && ${e} !== null` }
    : a.op === 'contains' ? { label: `${nm} contains ${v}`, cond: `String(${e}).includes(${JSON.stringify(v)})` }
    : { label: `${nm} ${a.op} ${v}`, cond: `${e} ${a.op === '=' ? '==' : a.op} ${lit(v)}` };
}
/** The handler block that holds the assertions (the rows travel in its first line so they can be edited again). */
export function assertionsBlock(rows: Assertion[]): string {
  const json = JSON.stringify(rows).replace(/%\}/g, '%\\u007d');
  const tests = rows.map((a) => { const { label, cond } = assertCode(a); return `client.test(${JSON.stringify(label)}, function () { client.assert(${cond}, ${JSON.stringify(`expected ${label}`)}); });`; });
  return ['> {%', `${MARK}${json}`, ...tests, '%}'].join('\n');
}
function requestRegion(lines: string[], line: number): { start: number; end: number } {
  let end = line; while (end < lines.length && !/^#{3,}/.test(lines[end].trim())) end++;
  return { start: line - 1, end };
}
/** The assertions saved for the request that starts at `line` (1-based). */
export function getAssertions(content: string, line: number): Assertion[] {
  const lines = content.split('\n'); const { start, end } = requestRegion(lines, line);
  const i = lines.slice(start, end).findIndex((l) => l.startsWith(MARK));
  if (i < 0) return [];
  try { const r = JSON.parse(lines[start + i].slice(MARK.length)); return Array.isArray(r) ? r : []; } catch { return []; }
}
/** Writes the assertions into the request that starts at `line`: replaces the block it made before, or adds one at the end. */
export function setAssertions(content: string, line: number, rows: Assertion[]): string {
  const lines = content.split('\n'); const { start, end } = requestRegion(lines, line);
  const i = lines.slice(start, end).findIndex((l) => l.startsWith(MARK));
  const block = rows.length ? assertionsBlock(rows).split('\n') : [];
  if (i >= 0) {
    let a = start + i; let b = a; while (b < end && !lines[b].trim().endsWith('%}')) b++;
    if (a > start && lines[a - 1].trim() === '> {%') a--;
    // taking the block away also takes the blank line that was added before it
    if (!block.length && a > start && !lines[a - 1].trim()) a--;
    lines.splice(a, b - a + 1, ...block);
    return lines.join('\n');
  }
  if (!block.length) return content;
  let at = end; while (at > start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, '', ...block);
  return lines.join('\n');
}
