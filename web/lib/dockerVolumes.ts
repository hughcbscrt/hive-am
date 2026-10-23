/**
 * The volumes of a Docker resource as the form's rows, and back to the same text it always saved (one `source:target[:options]` per
 * line). A line the rows cannot show (no target, or more than three parts) is kept as typed in a row of its own.
 */
export interface VolumeRow {
  /** A volume name or a folder of this machine. */ source: string; /** Where it goes inside the container. */ target: string;
  /** Docker's options as they were (`ro`, `z`, `nocopy`…); read-only is `ro` among them. */ opts: string[];
  /** The whole line, when it does not fit the row. */ raw?: string;
}

/** A source that is a folder of this machine rather than a volume name. */
export const isFolder = (source: string) => /^[/~.]/.test(source);

export function parseVolumeLine(line: string): VolumeRow {
  const l = line.trim();
  if (!l) return { source: '', target: '', opts: [] };
  const parts = l.split(':');
  if (parts.length === 2 || parts.length === 3) return { source: parts[0], target: parts[1], opts: parts[2] ? parts[2].split(',').filter(Boolean) : [] };
  return { source: '', target: '', opts: [], raw: l };
}

export function volumeLine(r: VolumeRow): string {
  if (r.raw !== undefined) return r.raw;
  if (!r.source && !r.target && !r.opts.length) return ' ';
  return `${r.source}:${r.target}${r.opts.length ? `:${r.opts.join(',')}` : ''}`;
}

/** Blank lines stay as empty rows (one just added, written as a space so a single one survives); saving drops them, as before. */
export const parseVolumes = (text: string): VolumeRow[] => (text === '' ? [] : text.split('\n').map(parseVolumeLine));
export const volumesText = (rows: VolumeRow[]) => rows.map(volumeLine).join('\n');
export const emptyRow = (): VolumeRow => ({ source: '', target: '', opts: [] });

export const isReadOnly = (r: VolumeRow) => r.opts.includes('ro');
/** Read-only on or off, keeping the other options in their order (`rw` goes away when it is turned on). */
export const withReadOnly = (r: VolumeRow, on: boolean): VolumeRow => ({ ...r, opts: on ? [...r.opts.filter((o) => o !== 'rw' && o !== 'ro'), 'ro'] : r.opts.filter((o) => o !== 'ro') });

/** A volume name the machine does not have yet (Docker creates it on the first start). Only said when the list of volumes is known. */
export const isNewVolume = (source: string, volumes: { name: string }[] | null) => !!source && !isFolder(source) && volumes !== null && !volumes.some((v) => v.name === source);
/** A row with only one side filled in: it cannot be saved (the server refuses `data:` and `:/data`). */
export const isIncomplete = (r: VolumeRow) => r.raw === undefined && !r.source.trim() !== !r.target.trim();
