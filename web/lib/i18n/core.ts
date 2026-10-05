import { en, type DictKey, type MessageKey } from './en';
import { es } from './es';

export type Locale = 'en' | 'es';
export const LOCALES: { id: Locale; short: string; name: string }[] = [
  { id: 'en', short: 'EN', name: 'English' },
  { id: 'es', short: 'ES', name: 'Español' },
];
/** Only the browser's localStorage remembers the language; it never appears in a URL. */
export const LOCALE_KEY = 'hive-locale';

const dicts: Record<Locale, Record<DictKey, string>> = { en, es };
let current: Locale = 'en';

export const getLocale = (): Locale => current;
export const setCurrentLocale = (l: Locale) => { current = l; };
/** BCP 47 tag for Intl / toLocale* APIs. */
export const intlLocale = () => (current === 'es' ? 'es-MX' : 'en-US');

export type Params = Record<string, string | number>;

/**
 * Looks a key up in the current language (falling back to English), fills `{placeholders}` and,
 * when `params.count` is a number, picks the `<key>_one` / `<key>_other` plural form.
 */
export function translate(key: MessageKey, params?: Params): string {
  const dict = dicts[current];
  let raw: string | undefined;
  if (params && typeof params.count === 'number') {
    const form = new Intl.PluralRules(intlLocale()).select(params.count) === 'one' ? 'one' : 'other';
    raw = dict[`${key}_${form}` as DictKey] ?? dict[`${key}_other` as DictKey];
  }
  raw ??= dict[key as DictKey] ?? en[key as DictKey] ?? key;
  return params ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : raw;
}

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * The server answers in English. Known messages are translated here so every error the admin shows
 * follows the selected language; anything unrecognised (e.g. a CLI's own stderr) is shown as-is.
 */
const SERVER_ERRORS: [RegExp, MessageKey, (string | number)[]?][] = [
  [/^Request body is not valid JSON$/, 'server.invalidJson'],
  [/^Name is required$/, 'server.nameRequired'],
  [/^Unknown provider "(.+)"$/, 'server.unknownProvider', ['name']],
  [/^Unknown provider$/, 'server.unknownProviderShort'],
  [/^Pick a provider$/, 'server.pickProvider'],
  [/^Role must be orchestrator or worker$/, 'server.badRole'],
  [/^Folder does not exist: (.+)$/, 'server.folderMissing', ['path']],
  [/^Not a folder$/, 'server.notFolder'],
  [/^That colony no longer exists$/, 'server.colonyGone'],
  [/^An agent named "(.+)" already exists$/, 'server.agentExists', ['name']],
  [/^A skill named "(.+)" already exists$/, 'server.skillExists', ['name']],
  [/^A type named "(.+)" already exists$/, 'server.typeExists', ['name']],
  [/^A colony named "(.+)" already exists$/, 'server.colonyExists', ['name']],
  [/^Choose a working folder, or put the agent in a colony that provides one\.$/, 'server.needFolderOrColony'],
  [/^Choose a working folder, or keep inheriting the colony’s folder\.$/, 'server.needFolderOrInherit'],
  [/^Agent not found$/, 'server.agentNotFound'],
  [/^Skill not found$/, 'server.skillNotFound'],
  [/^Type not found$/, 'server.typeNotFound'],
  [/^Colony not found$/, 'server.colonyNotFound'],
  [/^Message is empty$/, 'server.messageEmpty'],
  [/^Only the agent’s own conversations can be made current\. Delegated sessions are read-only\.$/, 'server.onlyOwnSessions'],
  [/^That session does not belong to this agent$/, 'server.sessionNotOwned'],
  [/^Only orchestrators can have subagents$/, 'server.onlyOrchestrators'],
  [/^from, agent and task are required$/, 'server.dispatchFields'],
  [/^Unknown orchestrator$/, 'server.unknownOrchestrator'],
  [/^No agent named "(.+)"$/, 'server.noAgentNamed', ['name']],
  [/^"(.+)" is not assigned to (.+)$/, 'server.notAssigned', ['worker', 'orchestrator']],
  [/^Unexpected server error$/, 'server.unexpected'],
  [/^No such route$/, 'server.noRoute'],
  [/^Not found$/, 'server.notFound'],
  [/^This agent has no working folder\. Set one on the agent or on its colony\.$/, 'server.noWorkingFolder'],
  [/^Agent no longer exists$/, 'server.agentGone'],
  [/^Request failed \((\d+)\)$/, 'server.requestFailed', ['status']],
];

export function translateServerError(message: string): string {
  for (const [re, key, names] of SERVER_ERRORS) {
    const m = re.exec(message);
    if (!m) continue;
    const params: Params = {};
    (names ?? []).forEach((n, i) => { params[String(n)] = m[i + 1]; });
    return translate(key, params);
  }
  return message;
}
