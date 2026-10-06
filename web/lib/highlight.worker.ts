import { highlightLines } from './highlight';

/** Highlights a whole file off the main thread so big files never block typing or scrolling. */
const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; code: string; path: string }>) => void) | null; postMessage: (m: unknown) => void };
ctx.onmessage = (e) => { const { id, code, path } = e.data; ctx.postMessage({ id, lines: highlightLines(code, path) }); };
