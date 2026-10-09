import type { Agent, Provider } from '../types.js';
import { runners } from '../providers/index.js';
import { inboxDir } from './files.js';
import type { SavedFile } from './types.js';

/**
 * Many models cannot look at images. When a connection names an "image model", every picture that arrives is described by
 * it (a one-off turn, nothing is remembered) and the description travels with the message, so any agent can answer about it.
 */
export interface VisionConfig { provider: Provider; model: string }

const MAX_IMAGES = 3;               // per message
const MAX_IMAGE_BYTES = 8_000_000;
const TIMEOUT_MS = 120_000;

export const validVision = (v: unknown): v is VisionConfig =>
  !!v && typeof v === 'object' && ['claude', 'opencode', 'kiro'].includes((v as any).provider) && typeof (v as any).model === 'string';

async function describe(agent: Agent, cfg: VisionConfig, path: string): Promise<string> {
  // A throwaway agent in the agent's own id (so its inbox is readable) and read-only: it can only look at the file.
  const helper: Agent = { ...agent, provider: cfg.provider, model: cfg.model, session_id: null, session_cwd: null, instr_hash: null, permission: 'plan', cwd: inboxDir(agent.id), system_prompt: '', skill_ids: [], skill_loads: {}, worker_ids: [] };
  const prompt = `Open the image file at ${path} with your file tools and look at it. Describe what it shows in a few plain sentences (people, objects, layout, colors), then transcribe any visible text exactly, as written. If you cannot open or see the image, reply exactly: CANNOT_SEE. Reply with only the description.`;
  let text = '';
  for await (const ev of runners[cfg.provider]({ agent: helper, prompt, instructions: '', mcpCaps: [], signal: AbortSignal.timeout(TIMEOUT_MS) })) {
    if (ev.t === 'text') text += ev.delta;
    else if (ev.t === 'tool') text = '';           // whatever it said before opening the file is not the description
    else if (ev.t === 'error') throw new Error(ev.message);
  }
  text = text.trim();
  if (!text || /CANNOT_SEE/.test(text)) throw new Error('the image model could not see the picture');
  return text.slice(0, 3000);
}

/** Adds a description to the images among `files` (in place). A failure is noted on the file, never thrown. */
export async function describeImages(agent: Agent, cfg: VisionConfig, files: SavedFile[]): Promise<void> {
  const images = files.filter((f) => f.kind === 'image' && f.size <= MAX_IMAGE_BYTES).slice(0, MAX_IMAGES);
  await Promise.all(images.map(async (f) => {
    try { f.description = await describe(agent, cfg, f.path); f.describedBy = `${cfg.provider}${cfg.model ? `/${cfg.model}` : ''}`; }
    catch (e) { f.descriptionError = e instanceof Error ? e.message : String(e); }
  }));
}
