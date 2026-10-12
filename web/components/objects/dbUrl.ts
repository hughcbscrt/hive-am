import type { DbEngine, DriverProp } from '@/lib/types';

export interface ParsedDbUrl {
  engine: DbEngine; host: string; port: string; user: string; password: string; database: string; file: string;
  ssl: boolean; trust: boolean; props: Record<string, string>;
}

const ENGINE: Record<string, DbEngine> = { postgres: 'postgresql', postgresql: 'postgresql', mysql: 'mysql', mariadb: 'mysql', mssql: 'mssql', sqlserver: 'mssql', sqlite: 'sqlite', file: 'sqlite' };

/**
 * Reads a connection URL (postgres://user:pass@host:5432/db?sslmode=require, mysql://…, mssql://…, sqlite:///path/to/file.db).
 * What the URL says about SSL is applied; a query parameter that is a driver property of that engine goes to the properties.
 * Returns null when it is not a URL it understands.
 */
export function parseDbUrl(text: string, known: DriverProp[] = []): ParsedDbUrl | null {
  const s = text.trim();
  const m = /^(?:jdbc:)?([a-z][a-z0-9+.-]*):/i.exec(s);
  const engine = m ? ENGINE[m[1].toLowerCase()] : undefined;
  if (!engine) return null;
  const out: ParsedDbUrl = { engine, host: '', port: '', user: '', password: '', database: '', file: '', ssl: false, trust: false, props: {} };
  if (engine === 'sqlite') {
    const path = s.replace(/^(?:jdbc:)?(?:sqlite|file):(?:\/\/)?/i, '').split('?')[0];
    const file = decodeURIComponent(path.startsWith('/') ? path : `/${path}`);
    return file.length > 1 ? { ...out, file } : null;
  }
  let u: URL;
  try { u = new URL(s.replace(/^jdbc:/i, '').replace(/^[a-z][a-z0-9+.-]*:/i, 'http:')); } catch { return null; }
  // An IPv6 address keeps its brackets, which is how the server takes it.
  out.host = u.hostname; out.port = u.port; out.user = decodeURIComponent(u.username); out.password = decodeURIComponent(u.password);
  out.database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const names = new Map(known.map((p) => [p.name.toLowerCase(), p]));
  u.searchParams.forEach((v, k) => {
    const key = k.toLowerCase(), val = v.toLowerCase();
    if (key === 'sslmode' || key === 'ssl' || key === 'encrypt' || key === 'tls') {
      out.ssl = !['disable', 'disabled', 'false', 'no', '0', 'allow', 'prefer'].includes(val) && val !== '';
      out.trust = out.ssl && ['require', 'required', 'preferred'].includes(val);   // like libpq: "require" encrypts without verifying the server
    } else if (key === 'trustservercertificate') out.trust = val === 'true';
    else { const p = names.get(key); if (p && !p.name.startsWith('ssl.')) out.props[p.name] = v; }
  });
  return out;
}
