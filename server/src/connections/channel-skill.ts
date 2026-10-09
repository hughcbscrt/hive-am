import { agents, db, skills } from '../db.js';
import { CHANNELS_SKILL_ID, WAKEUPS_SKILL_ID } from '../skills/defaults.js';
import { connections } from './store.js';

/**
 * Skills that ride along with connections, like the notebook skill rides along with the notebook: an agent that a connection answers through
 * gets "Chat channels" (how to behave in a chat) and "Wake-ups" (to tell people later; the tool exists only with the skill).
 * Each one is added once per agent: if the user takes it off an agent that still has connections, it is not added back. When the agent
 * has no enabled connection left, "Chat channels" is removed and the marker cleared, so a new connection starts from scratch.
 * "Wake-ups" is kept in that case, since it is also useful in the web chat.
 * If the user deleted a skill, nothing is added.
 */
const marker = (agentId: string, skillId: string) => `auto:${agentId}:${skillId}`;
const isMarked = (agentId: string, skillId: string) => !!db.prepare('SELECT 1 FROM seeded_skills WHERE slug=?').get(marker(agentId, skillId));
const mark = (agentId: string, skillId: string) => db.prepare('INSERT OR IGNORE INTO seeded_skills (slug) VALUES (?)').run(marker(agentId, skillId));
const unmark = (agentId: string, skillId: string) => db.prepare('DELETE FROM seeded_skills WHERE slug=?').run(marker(agentId, skillId));

export function syncChannelSkill(...agentIds: (string | null | undefined)[]): void {
  for (const id of new Set(agentIds.filter((x): x is string => !!x))) {
    const a = agents.get(id);
    if (!a) continue;
    const wants = connections.forAgent(id).length > 0;
    let ids = [...a.skill_ids];
    const loads = { ...a.skill_loads };
    for (const skillId of [CHANNELS_SKILL_ID, WAKEUPS_SKILL_ID]) {
      const has = ids.includes(skillId);
      if (wants) {
        if (!has && !isMarked(id, skillId) && skills.get(skillId)) { ids.push(skillId); loads[skillId] = 'always'; }
        mark(id, skillId);
      } else {
        unmark(id, skillId);
        if (has && skillId === CHANNELS_SKILL_ID) ids = ids.filter((s) => s !== skillId);
      }
    }
    if (ids.length !== a.skill_ids.length) agents.setSkills(id, ids, loads);
  }
}

/** Once: agents that already had a connection before the Chat channels skill existed get it, so their behaviour does not change. */
export function migrateChannelSkill(): void {
  const done = db.prepare("SELECT 1 FROM seeded_skills WHERE slug='migrate:channels'").get();
  if (done || !skills.get(CHANNELS_SKILL_ID)) return;
  db.prepare("INSERT OR IGNORE INTO seeded_skills (slug) VALUES ('migrate:channels')").run();
  syncChannelSkill(...connections.list().map((c) => c.agent_id));
}
