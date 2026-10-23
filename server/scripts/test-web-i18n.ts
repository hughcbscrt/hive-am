// That the web interface stays inside its dictionaries: en.ts and es.ts have the same keys, no `title`, `aria-label`,
// `placeholder` or `alt` and no element text is a literal outside EXCEPTIONS, and nothing under web/ uses the long dash
// (U+2014). Each check also runs on a planted defect, so it is shown to fail. No model, no browser, no server.
// Usage: HIVE_AM_HOME=$(mktemp -d) npx tsx scripts/test-web-i18n.ts
import './_guard.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from '../../web/lib/i18n/en.ts';
import { es } from '../../web/lib/i18n/es.ts';
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => { const ok = JSON.stringify(got) === JSON.stringify(want); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); if (!ok) fail++; };

// Technical terms, and example values of placeholders, that stay the same in both languages
// (also listed in docs/reference/*/11-frontend.md, section 11.8).
const EXCEPTIONS = ['HTTP', 'JSON', 'CSV', 'NULL', 'URL', 'IP', 'API key', 'Bearer token', 'Basic', 'Token', 'App Home', 'hive-am', 'true', 'false', 'Ctrl+Enter', 'Ctrl/⌘ + Enter', 'login', 'dev'];
const DASH = '\u2014';

const web = join(dirname(fileURLToPath(import.meta.url)), '../../web');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = ['components', 'app', 'lib'].flatMap((d) => walk(join(web, d))).filter((p) => /\.(tsx?|css)$/.test(p));

const missing = (a: object, b: object) => Object.keys(a).filter((k) => !(k in b));
// Text a person reads that is written in a .tsx instead of coming from t(): attribute values and element text with a letter.
// Values that are a placeholder ({{token}}), an example (https://…, $.data.id) or code are not words and are left out.
const WORDS = /^[\p{L}][\p{L}\s.,:;!?'’()-]*$/u;
const isLiteral = (s: string) => { const v = s.trim(); return WORDS.test(v) && !EXCEPTIONS.includes(v); };
function literals(src: string): string[] {
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)) if (isLiteral(m[2])) out.push(`${i + 1}: ${m[1]}="${m[2]}"`);
    // `>Text<` between two tags; `=>` and TypeScript generics (`<T>(`) do not look like this.
    for (const m of line.matchAll(/(?<![=-])>([^<>{}]+)</g)) if (isLiteral(m[1])) out.push(`${i + 1}: >${m[1].trim()}<`);
  });
  return out;
}
const dashes = (src: string) => src.split('\n').flatMap((l, i) => (l.includes(DASH) ? [`${i + 1}`] : []));

// 1. Same keys in both dictionaries
eq('en and es: every en key is in es', missing(en, es), []);
eq('en and es: every es key is in en', missing(es, en), []);
eq('planted: a key only in en is found', missing({ ...en, 'test.onlyEn': 'x' }, es), ['test.onlyEn']);

// 2. No long dash in the dictionaries or under web/components, web/app, web/lib
eq('dictionaries: no long dash', [...Object.entries(en), ...Object.entries(es)].filter(([, v]) => v.includes(DASH)).map(([k]) => k), []);
eq('web/: no long dash in any .ts, .tsx or .css', files.flatMap((p) => dashes(readFileSync(p, 'utf8')).map((n) => `${relative(web, p)}:${n}`)), []);
eq('planted: a long dash in a .tsx is found', dashes(`<p className="muted">${DASH}</p>`), ['1']);

// 3. No literal text in the components
eq('web/: no literal title, aria-label, placeholder, alt or element text', files.filter((p) => p.endsWith('.tsx')).flatMap((p) => literals(readFileSync(p, 'utf8')).map((l) => `${relative(web, p)}:${l}`)), []);
eq('planted: a literal aria-label is found', literals('<button aria-label="Close panel" />'), ['1: aria-label="Close panel"']);
eq('planted: a literal title and element text are found', literals('<dt title="Gateway">Entrypoint</dt>'), ['1: title="Gateway"', '1: >Entrypoint<']);
eq('technical terms in EXCEPTIONS pass', literals('<th>IP</th><span aria-label="URL">JSON</span>'), []);
eq('placeholders, examples and code pass', literals('<input placeholder="{{token}}" /><input placeholder="https://api.example.com" />{a > b ? x : y}<b>{n}</b>'), []);
eq('arrows and generics are not text', literals('const f = (x: Array<string>) => x.map((y) => <i>{y}</i>);'), []);

console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
