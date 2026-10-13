import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { execCapture } from './exec.js';
import { ObjectError } from './model.js';

/**
 * What Docker knows, to suggest in the forms: the containers on this machine, the images, and the services of a compose file. Read-only;
 * when Docker is not available the lists are empty and say why.
 */
const run = async (args: string[], o: { cwd?: string; timeout?: number } = {}) => {
  const r = await execCapture('docker', args, { cwd: o.cwd, timeout: o.timeout ?? 15_000, env: { ...process.env, DOCKER_CLI_HINTS: 'false' } });
  return { out: r.out, err: r.missing ? 'Docker is not installed or not in the PATH' : r.err, code: r.code };
};
const lines = (out: string): any[] => out.trim().split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

export interface ContainerInfo { id: string; name: string; image: string; state: string; status: string; ports: string; /** Created by hive-am for one of its objects. */ managed: boolean }
export interface ImageInfo { ref: string; id: string; size: string; created: string }

export async function listContainers(): Promise<{ available: boolean; error?: string; containers: ContainerInfo[] }> {
  const r = await run(['ps', '-a', '--format', '{{json .}}']);
  if (r.code !== 0) return { available: false, error: r.err.trim().split('\n').pop()?.slice(0, 200), containers: [] };
  const containers = lines(r.out).map((j) => ({ id: String(j.ID), name: String(j.Names), image: String(j.Image), state: String(j.State), status: String(j.Status), ports: String(j.Ports ?? ''), managed: /(^|,)hive-am\.object=/.test(String(j.Labels ?? '')) }));
  return { available: true, containers: containers.sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function listImages(): Promise<{ available: boolean; error?: string; images: ImageInfo[] }> {
  const r = await run(['images', '--format', '{{json .}}']);
  if (r.code !== 0) return { available: false, error: r.err.trim().split('\n').pop()?.slice(0, 200), images: [] };
  const images = lines(r.out).filter((j) => j.Repository && j.Repository !== '<none>').map((j) => ({ ref: j.Tag && j.Tag !== '<none>' ? `${j.Repository}:${j.Tag}` : String(j.Repository), id: String(j.ID), size: String(j.Size ?? ''), created: String(j.CreatedSince ?? '') }));
  return { available: true, images: [...new Map(images.map((i) => [i.ref, i])).values()].sort((a, b) => a.ref.localeCompare(b.ref)) };
}

/** Without Docker's help: the keys under a top-level `services:` (enough for ordinary compose files). */
function servicesByHand(text: string): string[] {
  const out: string[] = []; let inServices = false, indent = -1;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^services:\s*$/.test(line)) { inServices = true; indent = -1; continue; }
    if (!inServices) continue;
    const m = /^(\s*)([A-Za-z0-9._-]+):\s*(.*)$/.exec(line); if (!m) continue;
    if (m[1].length === 0) break;                                   // another top-level key ends the block
    if (indent < 0) indent = m[1].length;
    if (m[1].length === indent) out.push(m[2]);
  }
  return out;
}

export async function composeServices(file: string): Promise<{ services: string[]; project: string; source: 'docker' | 'file'; error?: string }> {
  if (!file.startsWith('/') || !/\.(ya?ml)$/i.test(file)) throw new ObjectError('Choose a compose file (.yml or .yaml)');
  if (!existsSync(file)) throw new ObjectError(`The file ${file} does not exist`);
  const project = basename(dirname(file)).toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[^a-z0-9]+/, '') || 'project';
  const r = await run(['compose', '-f', file, 'config', '--services'], { cwd: dirname(file) });
  if (r.code === 0) return { services: r.out.trim().split('\n').filter(Boolean).sort(), project, source: 'docker' };
  let text = ''; try { text = readFileSync(file, 'utf8'); } catch { /* unreadable */ }
  return { services: servicesByHand(text).sort(), project, source: 'file', error: r.err.trim().split('\n').pop()?.slice(0, 200) };
}
