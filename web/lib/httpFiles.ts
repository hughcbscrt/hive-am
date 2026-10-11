import { api } from './api';

/** Reading, saving and creating the .http files of an HTTP object (the one place that knows these routes). */
export const readHttpSource = (objectId: string, file: string) =>
  api.get<{ content: string }>(`/objects/${objectId}/http/file?file=${encodeURIComponent(file)}`).then((r) => r.content);
export const saveHttpSource = (objectId: string, file: string, content: string) => api.put(`/objects/${objectId}/http/file`, { file, content });
export const createHttpSource = (objectId: string, file: string, content: string) => api.post(`/objects/${objectId}/http/file`, { file, content });
/** Reads a file, changes its text and saves it. */
export async function editHttpSource(objectId: string, file: string, change: (content: string) => string): Promise<void> {
  await saveHttpSource(objectId, file, change(await readHttpSource(objectId, file)));
}
