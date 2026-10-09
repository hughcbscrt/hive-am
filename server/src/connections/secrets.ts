import { connections } from './store.js';

/**
 * Last line of defence for text an agent sends to a chat. The instructions tell the agent never to share secrets, but a model can be
 * talked into it (by anyone in a group, or by an admin who does not realise what the output holds), so the text is checked here
 * before it leaves this machine. It looks for well-known credential shapes and for the exact secrets this server knows about.
 * It cannot recognise every secret: it is a net under the rule, not a replacement for it.
 */
const SHAPES: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/, 'a private key'],
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/, 'a Telegram bot token'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/, 'a Stripe key'],
  [/\bsk-[A-Za-z0-9_-]{32,}\b/, 'an API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'a JWT'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/, 'a bearer token'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]{3,}@[^\s]+/i, 'a URL with a password in it'],
];

/** `NAME=value` / `name: value` where the name says it is a secret and the value looks real (not a placeholder). */
const ASSIGN = /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|credential|auth)[A-Za-z0-9_.-]*)\s*["']?\s*[:=]\s*["']?([^\s"'`,;]{8,})/gi;
const PLACEHOLDER = /^(<.*>|\{.*\}|\$\{?\w+\}?|\*+|x{4,}|\.{3,}|your[_-]|example|changeme|redacted|none|null|undefined|true|false|process\.env|env\.)/i;

const SECRET_ENV = /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;

/** Values that are secret because this server holds them: connection tokens and secret-looking environment variables. */
function knownSecrets(): string[] {
  const out = new Set<string>();
  for (const c of connections.list()) for (const k of ['token', 'signing_secret', 'app_token', 'bot_token']) { const v = c.config?.[k]; if (typeof v === 'string' && v.length >= 8) out.add(v); }
  for (const [k, v] of Object.entries(process.env)) if (v && v.length >= 12 && SECRET_ENV.test(k)) out.add(v);
  return [...out];
}

/** What kind of secret the text seems to contain, or null when it looks fine. Never returns the secret itself. */
export function findSecret(text: string): string | null {
  for (const s of knownSecrets()) if (text.includes(s)) return 'a secret held by hive-am or this machine';
  for (const [re, what] of SHAPES) if (re.test(text)) return what;
  for (const m of text.matchAll(ASSIGN)) if (!PLACEHOLDER.test(m[2])) return `the value of "${m[1]}"`;
  return null;
}

export const SECRET_REFUSAL = (what: string) =>
  `Not sent: the message seems to contain ${what}. Secrets (passwords, tokens, keys, connection strings) are never shared in a chat, not even with an admin or in a private chat. Tell the person you cannot share it and, if it helps, describe where it lives or how they can read it themselves, without writing its value.`;
