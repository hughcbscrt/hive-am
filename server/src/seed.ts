import { agents, skills, types } from './db.js';

/** First-run starter kit so the UI is never empty. Only runs on a fresh database. */
export function seedIfEmpty() {
  if (types.list().length || agents.list().length || skills.list().length) return;

  const s1 = skills.create({
    name: 'concise-reports', description: 'Short, structured final answers',
    content: 'Finish every task with a report: what you did, what you found, what is left. Use short bullet points. No filler.',
  });
  const s2 = skills.create({
    name: 'careful-reviewer', description: 'Review code for bugs before style',
    content: 'When reviewing, rank findings by severity. Report concrete failure scenarios, not preferences. Never edit files unless asked.',
  });

  types.create({
    name: 'Queen', role: 'orchestrator', provider: 'claude', model: 'sonnet', permission: 'acceptEdits', color: '#E8A317',
    description: 'Plans the work and delegates it to workers',
    system_prompt: 'You are an orchestrator. Break the request into independent tasks, delegate each to the best subagent, then merge their answers into one clear result.',
    skill_ids: [s1.id],
  });
  types.create({
    name: 'Builder', role: 'worker', provider: 'claude', model: 'sonnet', permission: 'acceptEdits', color: '#D97757',
    description: 'Implements features and fixes in the codebase',
    system_prompt: 'You implement changes carefully and verify them by running the project’s tests when they exist.',
    skill_ids: [s1.id],
  });
  types.create({
    name: 'Reviewer', role: 'worker', provider: 'opencode', model: '', permission: 'plan', color: '#3E7BFA',
    description: 'Reads code and reports problems without changing it',
    system_prompt: 'You review code. You never modify files.',
    skill_ids: [s2.id],
  });
}
