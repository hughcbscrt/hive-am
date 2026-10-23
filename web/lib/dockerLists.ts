/**
 * What the form does with the lists Docker gives (`/api/docker/*`). Pure, so a script can check it without a browser.
 */

/** A list from Docker, or `null` when Docker did not answer: then nothing can be said about what is or is not on this machine. */
export const whenAvailable = <T>(r: { available: boolean }, list: T[]): T[] | null => (r.available ? list : null);
