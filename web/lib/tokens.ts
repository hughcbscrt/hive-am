import type { Skill } from './types';

/** Rough size of a text in tokens (about four characters each): enough to compare skills, not to bill. */
export const estTokens = (text: string) => Math.ceil(text.length / 4);
export const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
/** What a skill costs in every turn: its whole text when always loaded, only its listing when on demand. */
export const skillWeight = (s: Pick<Skill, 'name' | 'description' | 'content' | 'load'>) => (s.load === 'on_demand' ? estTokens(`- **${s.name}**: ${s.description}`) : estTokens(s.content) + estTokens(s.name) + estTokens(s.description));
/** Above this, the skills an agent always carries start to crowd its context. */
export const ALWAYS_BUDGET = 3000;
