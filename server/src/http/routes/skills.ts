import { agents, resolved, skills } from '../../db.js';
import { body } from '../body.js';
import { HttpError, bad, notFound } from '../errors.js';
import { route } from '../router.js';
import { requireName, text, trimmed } from '../validate.js';

const checkLoad = (v: unknown) => { if (v !== undefined && v !== 'always' && v !== 'on_demand') throw bad('load must be always or on_demand'); };
type SkillPatch = Parameters<typeof skills.update>[1];

route('GET', '/api/skills', () => skills.list());
route('GET', '/api/skills/usage', () => skills.usage());
route('POST', '/api/skills', async ({ req }) => {
  const p = await body(req);
  const name = requireName(p.name);
  checkLoad(p.load);
  try { return skills.create({ name, description: (p.description as string | undefined) ?? '', content: (p.content as string | undefined) ?? '', load: p.load as 'always' | 'on_demand' | undefined }); }
  catch { throw bad(`A skill named "${text(p.name)}" already exists`); }   // the name is unique: that is what the insert refuses
});
route('PATCH', '/api/skills/:id', async ({ req, params }) => {
  const p = await body(req);
  checkLoad(p.load);
  try { return skills.update(params[0], p as SkillPatch) ?? (() => { throw notFound('Skill not found'); })(); }
  catch (e) { if (e instanceof HttpError) throw e; throw bad(`A skill named "${text(p.name)}" already exists`); }
});
route('DELETE', '/api/skills/:id', ({ params }) => { if (!skills.remove(params[0])) throw notFound('Skill not found'); return { ok: true }; });
// `skill_read`: the text of one of the skills the agent has, loaded when it needs it.
route('POST', '/api/skills/read', async ({ req }) => {
  const { from, name } = await body(req);
  const agent = agents.get(text(from)); if (!agent) throw bad('Unknown agent');
  const mine = resolved(agent).skill_ids.map((id) => skills.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  const want = trimmed(name).toLowerCase();
  const s = mine.find((x) => x.name.toLowerCase() === want);
  if (!s) throw bad(`No skill named "${text(name)}". Your skills: ${mine.map((x) => x.name).join(', ') || '(none)'}.`);
  return { name: s.name, content: s.content.trim() };
});
