import type { GitChange } from './types';

export interface TreeNode {
  name: string;          // display name (folders may be compacted: "src/components")
  path: string;          // full path; for compacted folders, the path of the deepest folder
  type: 'dir' | 'file';
  children: TreeNode[];
  change?: GitChange;
  /** Hidden by .gitignore. Folders are listed lazily, one level at a time, when opened. */
  ignored?: boolean;
  /** An ignored folder whose content has not been loaded yet. */
  lazy?: boolean;
  /** Changed files at or below this node. */
  changed: number;
  additions: number;
  deletions: number;
}

/** Builds the folder tree from the flat list of files, merging in changes (deleted/renamed paths included). */
export function buildTree(files: string[], changes: GitChange[], ignored: string[] = [], kids: Record<string, { name: string; dir: boolean }[]> = {}): TreeNode {
  const byPath = new Map(changes.map((c) => [c.path, c]));
  const all = new Set(files); for (const c of changes) all.add(c.path);

  const root: TreeNode = { name: '', path: '', type: 'dir', children: [], changed: 0, additions: 0, deletions: 0 };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const dirOf = (p: string): TreeNode => {
    const hit = dirs.get(p); if (hit) return hit;
    const i = p.lastIndexOf('/');
    const parent = dirOf(i < 0 ? '' : p.slice(0, i));
    const node: TreeNode = { name: p.slice(i + 1), path: p, type: 'dir', children: [], changed: 0, additions: 0, deletions: 0 };
    parent.children.push(node); dirs.set(p, node); return node;
  };
  for (const p of all) {
    const i = p.lastIndexOf('/');
    const parent = dirOf(i < 0 ? '' : p.slice(0, i));
    parent.children.push({ name: p.slice(i + 1), path: p, type: 'file', children: [], change: byPath.get(p), changed: byPath.has(p) ? 1 : 0, additions: byPath.get(p)?.additions ?? 0, deletions: byPath.get(p)?.deletions ?? 0 });
  }

  // Ignored entries: a folder is one dimmed node whose content is fetched when it is opened.
  const addIgnored = (parent: TreeNode, path: string, dir: boolean) => {
    const node: TreeNode = { name: path.slice(path.lastIndexOf('/') + 1), path, type: dir ? 'dir' : 'file', children: [], ignored: true, lazy: dir && !(path in kids), changed: 0, additions: 0, deletions: 0 };
    parent.children.push(node);
    if (dir) for (const k of kids[path] ?? []) addIgnored(node, `${path}/${k.name}`, k.dir);
  };
  for (const e of ignored) {
    const dir = e.endsWith('/'); const path = dir ? e.slice(0, -1) : e;
    const i = path.lastIndexOf('/');
    addIgnored(dirOf(i < 0 ? '' : path.slice(0, i)), path, dir);
  }

  const finish = (n: TreeNode): void => {
    n.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    for (const c of n.children) { if (c.type === 'dir') finish(c); n.changed += c.type === 'dir' ? c.changed : c.changed; n.additions += c.additions; n.deletions += c.deletions; }
    // Compact chains of single-child folders ("src/components/ui") the way editors do.
    n.children = n.children.map((c) => {
      let cur = c;
      while (cur.type === 'dir' && cur.children.length === 1 && cur.children[0].type === 'dir') {
        const only = cur.children[0];
        cur = { ...only, name: `${cur.name}/${only.name}` };
      }
      return cur;
    });
  };
  finish(root);
  return root;
}

export interface Row { node: TreeNode; depth: number }
export interface Filters { query: string; onlyChanged: boolean }

/** Visible rows for the current expansion state and filters. Searching expands every matching branch. */
export function flatten(root: TreeNode, expanded: Set<string>, f: Filters): Row[] {
  const q = f.query.trim().toLowerCase();
  const matches = (n: TreeNode): boolean => {
    if (f.onlyChanged && n.changed === 0) return false;
    if (!q) return true;
    if (n.type === 'file') return n.path.toLowerCase().includes(q);
    return n.children.some(matches);
  };
  const rows: Row[] = [];
  const walk = (n: TreeNode, depth: number) => {
    for (const c of n.children) {
      if (!matches(c)) continue;
      rows.push({ node: c, depth });
      if (c.type === 'dir' && (q || f.onlyChanged || expanded.has(c.path))) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Folders that should start open: the ones that lead to a change, or everything when the tree is small. */
export function defaultExpanded(root: TreeNode, totalFiles: number): Set<string> {
  const open = new Set<string>();
  const walk = (n: TreeNode) => {
    for (const c of n.children) if (c.type === 'dir' && !c.ignored) { if (totalFiles <= 40 || c.changed > 0) open.add(c.path); walk(c); }
  };
  walk(root);
  return open;
}
