import type { InstructionsSize, Skill, SkillLoad } from './types';

/** Rough size of a text in tokens (about four characters each): enough to compare skills, not to bill. */
export const estTokens = (text: string) => Math.ceil(text.length / 4);
export const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
/** What a skill costs in every turn: its whole text when always loaded, only its listing when on demand. */
export const skillWeight = (s: Pick<Skill, 'name' | 'description' | 'content' | 'load'>) => (s.load === 'on_demand' ? estTokens(`- **${s.name}**: ${s.description}`) : estTokens(s.content) + estTokens(s.name) + estTokens(s.description));
/** An agent's own skills and how each one is loaded: the saved ones or the draft's. */
export interface SkillChoice { skill_ids: string[]; skill_loads: Record<string, SkillLoad> }
/**
 * What saving the draft would change in the instructions, in estimated tokens: the weight of the agent's own skills in the draft
 * against the saved ones (in plan mode every skill stays in full), plus the list's header (`lazy_overhead_chars`) when the number of
 * skills on demand goes from 0 to more, or back to 0. Skills from the colony do not change here: they are in `on_demand` already.
 */
export function saveDelta(all: Pick<Skill, 'id' | 'name' | 'description' | 'content' | 'load'>[], saved: SkillChoice, draft: SkillChoice, size: Pick<InstructionsSize, 'plan_all' | 'on_demand' | 'lazy_overhead_chars'>) {
  const used = (c: SkillChoice) => c.skill_ids.flatMap((id) => {
    const s = all.find((x) => x.id === id);
    return s?.content.trim() ? [{ ...s, load: size.plan_all ? 'always' as const : c.skill_loads[id] ?? s.load }] : [];
  });
  const weigh = (c: SkillChoice) => used(c).reduce((n, s) => n + skillWeight(s), 0);
  const lazy = (c: SkillChoice) => used(c).filter((s) => s.load === 'on_demand').length;
  const before = size.on_demand.length, after = before - lazy(saved) + lazy(draft);
  const header = before === 0 && after > 0 ? 1 : before > 0 && after === 0 ? -1 : 0;
  return weigh(draft) - weigh(saved) + header * Math.ceil(size.lazy_overhead_chars / 4);
}
/** Above this, the skills an agent always carries start to crowd its context. */
export const ALWAYS_BUDGET = 3000;
/** The Instructions tab points at one skill always loaded when it is this heavy (estimated tokens) and this big a share of the total (%). */
export const HEAVY_SKILL_TOKENS = 800;
export const HEAVY_SKILL_SHARE = 25;
