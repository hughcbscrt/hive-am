import { agents, colonies, resolved, skills } from '../db.js';
import { connections } from '../connections/store.js';
import { platformName } from '../connections/prompt.js';
import { instructionParts, lazySkills, notebookBlock, type InstructionPart } from '../instructions.js';
import type { Agent, SkillLoad } from '../types.js';

/**
 * How big an agent's instructions are, part by part, so the heavy ones can be found. Measured on the saved agent as it runs (colony
 * values folded in) and as a direct conversation: a delegated task adds one sentence to the identity (about 170 characters). Tokens
 * are an estimate, one per four characters, the same rule as the web (`web/lib/tokens.ts`).
 */
export interface SizedPart {
  key: string; group: InstructionPart['group']; chars: number; tokens_est: number;
  skill_id?: string; skill_name?: string; mode?: SkillLoad; from_colony?: string; count?: number; channel?: string;
}
export interface InstructionsSize {
  provider: Agent['provider'];
  colony_id: string | null; colony_name: string | null;
  /** Claude in Read-only (plan) mode gets every skill in full, so switching one to on demand changes nothing there. */
  plan_all: boolean;
  total_chars: number; total_tokens_est: number;
  parts: SizedPart[];
  /** The skills that are only listed (read on demand), with where each one comes from, so they can be switched back. */
  on_demand: { skill_id: string; skill_name: string; from_colony?: string }[];
  /** The notes go after the instructions and change as the agent writes: shown apart, not in the total. */
  notebook_chars: number; notebook_tokens_est: number;
}

export const estTokens = (chars: number) => Math.ceil(chars / 4);

export function instructionsSize(agent: Agent): InstructionsSize {
  const a = resolved(agent);
  const col = a.colony_id ? colonies.get(a.colony_id) : undefined;
  const inheritsSkills = !!col && a.effective.inherited.includes('skills');
  // A skill counts as the colony's only when the agent does not also pick it itself: then the agent's own choice is the one that applies.
  const fromColony = (id: string) => (inheritsSkills && col!.skill_ids.includes(id) && !agent.skill_ids.includes(id) ? col!.name : undefined);
  const lazy = lazySkills(a);
  const parts = instructionParts(a).map((p): SizedPart => {
    const out: SizedPart = { key: p.key, group: p.group, chars: p.text.length, tokens_est: estTokens(p.text.length) };
    if (p.group === 'colony' && col) out.from_colony = col.name;
    if (p.skill_id) {
      out.skill_id = p.skill_id;
      out.skill_name = skills.get(p.skill_id)?.name;
      out.mode = a.skill_loads[p.skill_id] ?? 'always';
      const c = fromColony(p.skill_id); if (c) out.from_colony = c;
    }
    if (p.group === 'lazy_list') out.count = lazy.length;
    if (p.group === 'team') out.count = a.worker_ids.filter((id) => agents.get(id)).length;
    if (p.key === 'channel') out.channel = [...new Set(connections.forAgent(a.id).map((c) => platformName(c.kind)))].join(' / ');
    return out;
  });
  const total = parts.reduce((n, p) => n + p.chars, 0);
  const notes = notebookBlock(a).length;
  return {
    provider: a.provider, colony_id: col?.id ?? null, colony_name: col?.name ?? null,
    plan_all: a.provider === 'claude' && a.permission === 'plan',
    total_chars: total, total_tokens_est: estTokens(total), parts,
    on_demand: lazy.map((s) => { const c = fromColony(s.id); return c ? { skill_id: s.id, skill_name: s.name, from_colony: c } : { skill_id: s.id, skill_name: s.name }; }),
    notebook_chars: notes, notebook_tokens_est: estTokens(notes),
  };
}
