import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import perl from 'highlight.js/lib/languages/perl';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGS: Record<string, unknown> = { bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, makefile, markdown, perl, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [n, l] of Object.entries(LANGS)) hljs.registerLanguage(n, l as never);

const EXT: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', css: 'css', scss: 'scss', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
  md: 'markdown', mdx: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', pl: 'perl', pm: 'perl',
  sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', conf: 'ini', cfg: 'ini', sql: 'sql', diff: 'diff', patch: 'diff', mk: 'makefile',
};

export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return EXT[ext] ?? null;
}

export const HIGHLIGHT_MAX_CHARS = 1_200_000;   // above any file the server will send; big ones are highlighted off the main thread
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * One HTML string per line. Tokens that span several lines (comments, template strings) are closed at the end of each
 * line and reopened on the next, so every line is a self-contained fragment that can be rendered on its own.
 */
export function highlightLines(code: string, path: string): string[] {
  const lang = languageOf(path);
  let html: string;
  if (!lang || code.length > HIGHLIGHT_MAX_CHARS) html = esc(code);
  else { try { html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { html = esc(code); } }
  const out: string[] = []; const open: string[] = [];
  let cur = '';
  const re = /<span [^>]*>|<\/span>|\n|[^<\n]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok === '\n') { out.push(cur + '</span>'.repeat(open.length)); cur = open.join(''); }
    else { if (tok.startsWith('<span')) open.push(tok); else if (tok === '</span>') open.pop(); cur += tok; }
  }
  out.push(cur + '</span>'.repeat(open.length));
  return out;
}

/** Highlight a single line on its own (diff rows). */
export const highlightLine = (text: string, path: string): string => highlightLines(text, path)[0] ?? '';

/**
 * Make spaces and tabs visible without changing the text's width: each one keeps its real character, and a marker
 * (· or →) is drawn over it with CSS. Only text between tags is touched.
 */
export function showWhitespace(html: string): string {
  return html.replace(/(^|>)([^<]+)/g, (_m, pre: string, text: string) => pre + text.replace(/[\t ]/g, (c) => (c === '\t' ? '<i class="ws-t">\t</i>' : '<i class="ws-s"> </i>')));
}
