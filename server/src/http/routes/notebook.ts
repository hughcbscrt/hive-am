import { liveIsDirect, notifyAgentsChanged } from '../../runtime.js';
import { notebooks } from '../../skills/notebook.js';
import { NOTEBOOK_SKILL_ID } from '../../skills/defaults.js';
import { nbView, noteSource, notebookAgent, notebookEnabled } from '../../services/notebook.js';
import { agentOrFail } from '../../services/agents.js';
import { body } from '../body.js';
import { requireLocal } from '../guards.js';
import { route } from '../router.js';
import { text } from '../validate.js';

// The agent's tools (`from` is its id) and the interface. NotebookError becomes a 400 in http/errors.ts.
route('POST', '/api/notebook/read', async ({ req }) => { const { from } = await body(req); return nbView(notebooks.get(notebookAgent(from).id)); });
route('POST', '/api/notebook/add', async ({ req }) => {
  const { from, section, note } = await body(req); const a = notebookAgent(from);
  const r = notebooks.add(a.id, text(section), text(note), noteSource(a.id), liveIsDirect(a.id));
  return { added: r.added, note: r.note, ...nbView(r.notebook) };
});
route('POST', '/api/notebook/rewrite', async ({ req }) => {
  const { from, content, version } = await body(req); const a = notebookAgent(from);
  return { added: true, ...nbView(notebooks.rewrite(a.id, text(content), Number(version), liveIsDirect(a.id))) };
});
route('GET', '/api/agents/:id/notebook', ({ params }) => {
  const a = agentOrFail(params[0]);
  const n = notebooks.get(a.id);
  return { ...nbView(n), updated_at: n.updated_at, updated_by: n.updated_by, enabled: notebookEnabled(a), skill_id: NOTEBOOK_SKILL_ID, shared_with: notebooks.sharedWith(a.id) };
});
route('PUT', '/api/agents/:id/notebook', async ({ req, params }) => {
  requireLocal(req, 'The notebook can only be edited from the local app');
  const a = agentOrFail(params[0]);
  const p = await body(req);
  const n = notebooks.edit(a.id, text(p.content), typeof p.version === 'number' ? p.version : undefined);
  return { ...nbView(n), updated_at: n.updated_at, updated_by: n.updated_by };
});
// Leaves the notebook it shares: the agent keeps a copy of the current text of its own and the others keep the shared one.
route('POST', '/api/agents/:id/notebook/separate', ({ req, params }) => {
  requireLocal(req, 'The notebook can only be changed from the local app');
  const a = agentOrFail(params[0]);
  const n = notebooks.separate(a.id);
  notifyAgentsChanged();
  return { ...nbView(n), updated_at: n.updated_at, updated_by: n.updated_by, shared_with: notebooks.sharedWith(a.id) };
});
