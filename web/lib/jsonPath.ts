/** A small JSONPath: `$`, `.key`, `['key']`, `[0]`, `[-1]`, `[*]`, `.*`, `..key` and filters like `[?(@.price > 10)]` / `[?(@.name == "x")]`. */
type Step = { k: 'key'; v: string } | { k: 'idx'; v: number } | { k: 'all' } | { k: 'deep'; v: string } | { k: 'filter'; path: string; op: string; v: unknown };

function parse(path: string): Step[] {
  const src = path.trim(); if (!src.startsWith('$')) throw new Error('A path starts with $');
  const steps: Step[] = []; let i = 1;
  while (i < src.length) {
    if (src.startsWith('..', i)) { const m = /^\.\.([\w$-]+)/.exec(src.slice(i)); if (!m) throw new Error('Expected a name after ..'); steps.push({ k: 'deep', v: m[1] }); i += m[0].length; continue; }
    if (src[i] === '.') { const m = /^\.(\*|[\w$-]+)/.exec(src.slice(i)); if (!m) throw new Error(`Unexpected "${src[i + 1] ?? ''}" after the dot`); steps.push(m[1] === '*' ? { k: 'all' } : { k: 'key', v: m[1] }); i += m[0].length; continue; }
    if (src[i] === '[') {
      const e = src.indexOf(']', i); if (e < 0) throw new Error('A [ is not closed');
      const inner = src.slice(i + 1, e).trim();
      let m: RegExpExecArray | null;
      if (inner === '*') steps.push({ k: 'all' });
      else if (/^-?\d+$/.test(inner)) steps.push({ k: 'idx', v: Number(inner) });
      else if ((m = /^(['"])(.*)\1$/.exec(inner))) steps.push({ k: 'key', v: m[2] });
      else if ((m = /^\?\(\s*@((?:\.[\w$-]+)*)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*\)$/.exec(inner))) { let v: unknown = m[3]; try { v = JSON.parse(m[3].replace(/^'(.*)'$/, '"$1"')); } catch { /* stays text */ } steps.push({ k: 'filter', path: m[1], op: m[2], v }); }
      else throw new Error(`Cannot read [${inner}]`);
      i = e + 1; continue;
    }
    throw new Error(`Unexpected "${src[i]}"`);
  }
  return steps;
}
const children = (x: unknown): unknown[] => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
function deep(x: unknown, key: string, out: unknown[]) {
  if (x && typeof x === 'object' && !Array.isArray(x) && key in (x as object)) out.push((x as Record<string, unknown>)[key]);
  for (const c of children(x)) deep(c, key, out);
}
const cmp = (a: unknown, op: string, b: unknown) => (op === '==' ? a === b || String(a) === String(b) : op === '!=' ? !(a === b || String(a) === String(b)) : op === '>' ? Number(a) > Number(b) : op === '<' ? Number(a) < Number(b) : op === '>=' ? Number(a) >= Number(b) : Number(a) <= Number(b));
/** Every value the path reaches (an empty list when nothing matches). Throws a short message when the path cannot be read. */
export function jsonPath(root: unknown, path: string): unknown[] {
  let cur: unknown[] = [root];
  for (const s of parse(path)) {
    const next: unknown[] = [];
    for (const x of cur) {
      if (s.k === 'key') { if (x && typeof x === 'object' && !Array.isArray(x) && s.v in (x as object)) next.push((x as Record<string, unknown>)[s.v]); }
      else if (s.k === 'idx') { if (Array.isArray(x)) { const v = x[s.v < 0 ? x.length + s.v : s.v]; if (v !== undefined) next.push(v); } }
      else if (s.k === 'all') next.push(...children(x));
      else if (s.k === 'deep') deep(x, s.v, next);
      else for (const c of children(x)) { let v: unknown = c; for (const p of s.path.split('.').filter(Boolean)) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[p] : undefined; if (v !== undefined && cmp(v, s.op, s.v)) next.push(c); }
    }
    cur = next;
  }
  return cur;
}
