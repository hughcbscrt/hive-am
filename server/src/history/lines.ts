import { readFileSync } from 'node:fs';

/** The JSON objects of a JSONL transcript, in order. A line that is cut or damaged (a CLI still writing) is skipped, not fatal. */
export function* jsonLines(file: string): Generator<any> {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try { yield JSON.parse(line); } catch { /* partial line */ }
  }
}
