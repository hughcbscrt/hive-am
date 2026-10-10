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
