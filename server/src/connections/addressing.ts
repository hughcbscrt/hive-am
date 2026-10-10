/**
 * Who is a message in a group for? A name inside a sentence is not a call ("pruebas de esas ramas en AutoAfiliacion" is about a project, not to the agent),
 * and a message that starts with somebody else's name ("Fer, le agregué…") is for them. These helpers decide that from the words, in Spanish and English.
 */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Words that, right before a name, mean "I am talking to you" (a call), and words that make it a noun ("the AutoAfiliacion project"). */
const CALL_BEFORE = new Set(['hola', 'hey', 'oye', 'oiga', 'ok', 'oki', 'okay', 'gracias', 'verdad', 'cierto', 'entonces', 'bueno', 'pues', 'ya', 'mira', 'dime', 'di', 'porfa', 'favor', 'y', 'ah', 'eh', 'hi', 'hello', 'thanks', 'right', 'so', 'well', 'please', 'dear', 'amigo', 'buenas', 'buenos', 'dias', 'tardes', 'noches']);
const NOUN_BEFORE = new Set(['en', 'de', 'del', 'con', 'para', 'por', 'sobre', 'a', 'al', 'la', 'el', 'los', 'las', 'un', 'una', 'este', 'ese', 'esta', 'esa', 'tu', 'su', 'mi', 'nuestro', 'proyecto', 'rama', 'ramas', 'app', 'of', 'in', 'on', 'the', 'to', 'for', 'with', 'about', 'project']);
const PUNCT_CALL = /[,:;!?¡¿\-—(]/;

interface Tok { text: string; folded: string; word: boolean; start: number; end: number }
function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ text: m[0], folded: fold(m[0]), word: /[\p{L}\p{N}]/u.test(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}

/**
 * The first of `names` that the text speaks TO (a vocative), or null. A name is a call when it opens the message (after an optional greeting), follows a comma or
 * a greeting/tag word ("verdad Gael?", "gracias Gael"), or is followed by a comma/colon. After a preposition or article it is just a noun.
 * With `loose`, a name also matches by its start (3+ letters): "Fer" is "Fernando".
 */
export function vocativeOf(names: string[], text: string, loose = false): string | null {
  const wanted = names.map((n) => ({ name: n, parts: tokens(n.trim()).filter((x) => x.word).map((x) => x.folded) })).filter((n) => n.parts.length && n.parts.join('').length >= 3);
  if (!wanted.length) return null;
  const t = tokens(text);
  for (let i = 0; i < t.length; i++) {
    if (!t[i].word) continue;
    const hit = wanted.find((n) => {
      if (n.parts.length === 1) return t[i].folded === n.parts[0] || (loose && t[i].folded.length >= 3 && n.parts[0].startsWith(t[i].folded));
      const words = t.slice(i).filter((x) => x.word).slice(0, n.parts.length);       // a name of several words ("Autoafiliacion Web")
      return words.length === n.parts.length && words.every((w, k) => w.folded === n.parts[k]);
    });
    if (!hit) continue;
    const span = hit.parts.length;
    let last = i, seen = 1;
    while (seen < span && last + 1 < t.length) { last++; if (t[last].word) seen++; }
    const prev = t.slice(0, i), p1 = prev[prev.length - 1], p2 = prev[prev.length - 2], next = t[last + 1];
    const wordsBefore = prev.filter((x) => x.word).length;
    const atStart = wordsBefore === 0 || (wordsBefore <= 2 && prev.filter((x) => x.word).every((x) => CALL_BEFORE.has(x.folded)));
    const afterPunct = !!p1 && !p1.word && PUNCT_CALL.test(p1.text);
    const porFavor = !!p1 && p1.folded === 'favor' && !!p2 && p2.folded === 'por';          // "por favor Fernando" is a call even though "por" usually is not
    const afterCallWord = porFavor || (!!p1 && p1.word && CALL_BEFORE.has(p1.folded) && !(p2 && p2.word && NOUN_BEFORE.has(p2.folded)));
    const nounUse = !!p1 && p1.word && NOUN_BEFORE.has(p1.folded);
    const beforePunct = !!next && !next.word && /[,:;!?]/.test(next.text);
    if (nounUse) continue;
    if (atStart || afterPunct || afterCallWord || (beforePunct && wordsBefore <= 3)) return hit.name;
  }
  return null;
}

/** The agent was called by name (one of its aliases) as a vocative. */
export const calledByName = (aliases: string[], text: string): boolean => vocativeOf(aliases, text) !== null;

/**
 * The message is about or for somebody else who is in this chat (`people`: the other humans' first names): their name appears in it (3+ letters, "Fer" is "Fernando").
 * Used only when the agent was not called itself: people talking to each other are not the agent's business.
 */
export function directedAtOther(people: string[], text: string): string | null {
  const names = people.map((n) => ({ name: n, key: fold(n.trim()) })).filter((n) => n.key.length >= 3);
  for (const t of tokens(text)) {
    if (!t.word || t.folded.length < 3) continue;
    const hit = names.find((n) => t.folded === n.key || n.key.startsWith(t.folded));
    if (hit) return hit.name;
  }
  return null;
}

/** First names to compare against: "Fernando Merino" → "Fernando"; usernames are kept as they are. */
export const firstNames = (names: (string | null | undefined)[], exclude: string[] = []): string[] => {
  const skip = new Set(exclude.map((x) => fold(x.trim())));
  const out = new Set<string>();
  for (const n of names) { const f = (n ?? '').trim().split(/\s+/)[0]; if (f.length >= 3 && !skip.has(fold(f))) out.add(f); }
  return [...out];
};
