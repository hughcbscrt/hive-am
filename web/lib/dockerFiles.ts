import { api } from './api';

/** Reading, saving and copying the compose file of a compose resource and a Dockerfile (the one place that knows these routes). */
export type SourceKind = 'compose' | 'dockerfile';
export interface SourceFile { path: string; content: string; etag: string; bytes: number }
/** `check` is what `docker compose config` said of the saved file (`null` without Docker); `running`, whether services still run the old one. */
export interface SavedFile { path: string; etag: string; bytes: number; check?: { ok: boolean; error?: string } | null; running?: boolean }

export const readCompose = (objectId: string) => api.get<SourceFile>(`/objects/${objectId}/docker/file`);
export const saveCompose = (objectId: string, content: string, etag: string) => api.put<SavedFile>(`/objects/${objectId}/docker/file`, { content, etag });
export const copyCompose = (objectId: string, p: { name: string; content: string; overwrite: boolean; repoint: boolean }) => api.post<SavedFile>(`/objects/${objectId}/docker/file/copy`, p);
export const readDockerfile = (path: string) => api.get<SourceFile>(`/docker/dockerfile?path=${encodeURIComponent(path)}`);
export const saveDockerfile = (path: string, content: string, etag: string) => api.put<SavedFile>('/docker/dockerfile', { path, content, etag });
export const copyDockerfile = (path: string, p: { name: string; content: string; overwrite: boolean }) => api.post<SavedFile>('/docker/dockerfile/copy', { path, ...p });

/**
 * The name offered for a copy, next to the original and valid for its kind: `docker-compose.yml` → `docker-compose.copy.yml`,
 * `Dockerfile` → `Dockerfile.copy`, `web.Dockerfile` → `web.copy.Dockerfile` (a Dockerfile copy must still be named like one).
 */
export function copyNameFor(kind: SourceKind, path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ext = kind === 'compose' ? /\.ya?ml$/i.exec(name)?.[0] : /\.(dockerfile|containerfile)$/i.exec(name)?.[0];
  return ext ? `${name.slice(0, -ext.length)}.copy${ext}` : `${name}.copy`;
}
/** The folder of a path, where the copy goes. */
export const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
