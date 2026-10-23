/**
 * What the form does with the lists Docker gives (`/api/docker/*`). Pure, so a script can check it without a browser.
 */

/** A list from Docker, or `null` when Docker did not answer: then nothing can be said about what is or is not on this machine. */
export const whenAvailable = <T>(r: { available: boolean }, list: T[]): T[] | null => (r.available ? list : null);

export type MadeKind = 'network' | 'volume';
/** The names the server accepts for a network or a volume it creates (the same rules as objects/docker.ts). */
const NAME: Record<MadeKind, RegExp> = { network: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, volume: /^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/ };
export const validName = (kind: MadeKind, name: string) => NAME[kind].test(name) && !(kind === 'volume' && /^[0-9a-f]{64}$/.test(name));

/** "Create" is offered for a valid name Docker said it does not have (never while Docker is not answering). */
export const canCreate = (kind: MadeKind, name: string, list: { name: string }[] | null) => {
  const n = name.trim();
  return list !== null && validName(kind, n) && !list.some((x) => x.name === n);
};

/** Only what hive-am created, unused, and neither Docker's own network nor an anonymous volume, offers delete (the server checks again). */
export const canRemove = (x: { managed: boolean; inUse: number; builtin?: boolean; anonymous?: boolean }) => x.managed && x.inUse === 0 && !x.builtin && !x.anonymous;

/** A name for an image built from a Dockerfile, from its folder: `/home/you/My App/Dockerfile` gives `my-app:latest`. */
export const imageNameFor = (dockerfile: string) => {
  const parts = dockerfile.split('/').filter(Boolean);
  const base = (parts.at(-2) ?? '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '');
  return base ? `${base}:latest` : '';
};
