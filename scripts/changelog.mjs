// CHANGELOG.md in the Keep a Changelog 1.1.0 format (https://keepachangelog.com/es-ES/1.1.0/).
//   node scripts/changelog.mjs add [type] [message]   add an entry to the unreleased section (asks for what is missing)
//   node scripts/changelog.mjs show                    print the unreleased section
// The functions below are also used by release.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FILE = join(root, 'CHANGELOG.md');

export const TYPES = [
  { key: 'Added', es: 'Añadido', aliases: ['a', 'add', 'added', 'añadido', 'anadido', 'nuevo'] },
  { key: 'Changed', es: 'Cambiado', aliases: ['c', 'change', 'changed', 'cambiado', 'cambio'] },
  { key: 'Deprecated', es: 'Obsoleto', aliases: ['d', 'deprecated', 'obsoleto'] },
  { key: 'Removed', es: 'Eliminado', aliases: ['r', 'remove', 'removed', 'eliminado', 'quitado'] },
  { key: 'Fixed', es: 'Corregido', aliases: ['f', 'fix', 'fixed', 'corregido', 'arreglado'] },
  { key: 'Security', es: 'Seguridad', aliases: ['s', 'security', 'seguridad'] },
];
const T = {
  es: {
    unreleased: 'Sin publicar',
    intro: '# Registro de cambios\n\nTodos los cambios notables de hive-am se documentan en este archivo.\n\nEl formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto sigue el [Versionado Semántico](https://semver.org/lang/es/).\n',
  },
  en: {
    unreleased: 'Unreleased',
    intro: '# Changelog\n\nAll notable changes to hive-am are documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/).\n',
  },
};
export const label = (type, lang) => (lang === 'es' ? type.es : type.key);
export const findType = (word) => TYPES.find((t) => [t.key, t.es, ...t.aliases].some((a) => a.toLowerCase() === String(word).trim().toLowerCase()));

const repoUrl = () => {
  const r = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).repository?.url ?? '';
  return r.replace(/^git\+/, '').replace(/\.git$/, '');
};

/** { lang, intro, unreleased: { Added: [...], ... }, releases: [{ version, date, body }] } */
export function load() {
  const text = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';
  const lang = /Sin publicar|Registro de cambios|### (Añadido|Corregido)/.test(text) ? 'es' : 'en';   // English unless the file is already in Spanish
  const unreleased = Object.fromEntries(TYPES.map((t) => [t.key, []]));
  const releases = [];
  if (!text) return { lang, intro: T[lang].intro, unreleased, releases };

  const body = text.split('\n').filter((l) => !/^\[[^\]]+\]: https?:\/\//.test(l)).join('\n');
  const parts = body.split(/^## /m);
  const intro = parts.shift().trimEnd() + '\n';
  for (const part of parts) {
    const [head, ...rest] = part.split('\n');
    const content = rest.join('\n').trim();
    if (/^\[(Unreleased|Sin publicar)\]/i.test(head)) {
      let current = null;
      for (const line of content.split('\n')) {
        const h = line.match(/^### (.+)/);
        if (h) { current = findType(h[1]); continue; }
        if (!current || !line.trim()) continue;
        if (/^[-*] /.test(line)) unreleased[current.key].push(line.replace(/^[-*] /, '').trim());
        else if (unreleased[current.key].length) unreleased[current.key][unreleased[current.key].length - 1] += ` ${line.trim()}`;
      }
    } else {
      const m = head.match(/^\[([^\]]+)\](?: - (\S+))?/);
      if (m) releases.push({ version: m[1], date: m[2] ?? '', body: content });
    }
  }
  return { lang, intro, unreleased, releases };
}

export const countEntries = (u) => TYPES.reduce((n, t) => n + u[t.key].length, 0);

export function sectionsText(u, lang) {
  return TYPES.filter((t) => u[t.key].length).map((t) => `### ${label(t, lang)}\n\n${u[t.key].map((e) => `- ${e}`).join('\n')}`).join('\n\n');
}

export function save(data) {
  const { lang, intro, unreleased, releases } = data;
  const base = repoUrl();
  const out = [intro.trimEnd(), `## [${T[lang].unreleased}]${countEntries(unreleased) ? `\n\n${sectionsText(unreleased, lang)}` : ''}`];
  for (const r of releases) out.push(`## [${r.version}] - ${r.date}\n\n${r.body}`);
  const links = [`[${T[lang].unreleased}]: ${base}/${releases.length ? `compare/v${releases[0].version}...HEAD` : 'commits'}`];
  releases.forEach((r, i) => links.push(`[${r.version}]: ${base}/${releases[i + 1] ? `compare/v${releases[i + 1].version}...v${r.version}` : `releases/tag/v${r.version}`}`));
  writeFileSync(FILE, `${out.join('\n\n')}\n\n${links.join('\n')}\n`);
}

/** Moves the unreleased entries into a new release and saves the file. */
export function release(data, version, date) {
  data.releases.unshift({ version, date, body: sectionsText(data.unreleased, data.lang) });
  data.unreleased = Object.fromEntries(TYPES.map((t) => [t.key, []]));
  save(data);
}

export const ask = async (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
};

/** Asks, type by type, for entries (one per line, empty line to finish a type). */
export async function askEntries(data) {
  const es = data.lang === 'es';
  console.log(es ? '\nEscribe los cambios de esta versión, uno por línea. Línea vacía para pasar al siguiente tipo.' : '\nWrite the changes of this version, one per line. Empty line to move to the next type.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const t of TYPES) {
      console.log(`\n### ${label(t, data.lang)}`);
      for (;;) {
        const line = (await rl.question('  - ')).trim();
        if (!line) break;
        data.unreleased[t.key].push(line);
      }
    }
  } finally { rl.close(); }
}

// ---- CLI ----
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, typeArg, ...msg] = process.argv.slice(2);
  const data = load();
  if (cmd === 'show') {
    console.log(countEntries(data.unreleased) ? sectionsText(data.unreleased, data.lang) : '(sin cambios por publicar)');
  } else if (cmd === 'add') {
    let type = typeArg ? findType(typeArg) : null;
    if (typeArg && !type) { console.error(`Tipo desconocido "${typeArg}". Usa: ${TYPES.map((t) => `${t.key}/${t.es}`).join(', ')}`); process.exit(1); }
    if (!type) {
      console.log(TYPES.map((t, i) => `  ${i + 1}) ${label(t, data.lang)}`).join('\n'));
      const pick = await ask('Tipo (número o nombre): ');
      type = TYPES[Number(pick) - 1] ?? findType(pick);
      if (!type) { console.error('Tipo no válido.'); process.exit(1); }
    }
    let text = msg.join(' ').trim() || (await ask('Cambio: '));
    if (!text) { console.error('Nada que agregar.'); process.exit(1); }
    data.unreleased[type.key].push(text);
    save(data);
    console.log(`Agregado a "${label(type, data.lang)}": ${text}`);
  } else {
    console.error('Uso: changelog.mjs add [tipo] [mensaje] | show');
    process.exit(1);
  }
}
