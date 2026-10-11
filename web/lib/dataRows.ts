/** Rows of data for a batch run: a CSV (first line = names, commas or semicolons, quotes allowed) or a JSON array of objects. */
export function parseRows(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const src = text.trim(); if (!src) throw new Error('No data');
  if (src.startsWith('[') || src.startsWith('{')) {
    const j = JSON.parse(src); const arr = Array.isArray(j) ? j : [j];
    if (!arr.every((r) => r && typeof r === 'object' && !Array.isArray(r))) throw new Error('A JSON array of objects is expected');
    const columns = [...new Set(arr.flatMap((r) => Object.keys(r)))];
    return { columns, rows: arr.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] === undefined || r[c] === null ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c])]))) };
  }
  const first = src.split(/\r?\n/, 1)[0]; const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const recs: string[][] = []; let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) recs.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x !== '')) recs.push(row);
  const columns = recs[0].map((c) => c.trim());
  if (columns.some((c) => !/^[A-Za-z_][\w.-]{0,80}$/.test(c))) throw new Error('The first line must be the variable names (letters, numbers, _ . -)');
  return { columns, rows: recs.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? '']))) };
}
