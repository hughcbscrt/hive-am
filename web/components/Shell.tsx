'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Boxes, Hexagon, History, Library, Moon, Network, Sun, Users } from 'lucide-react';
import { HiveProvider, useHive } from '@/lib/store';
import { Toaster } from './ui';

function HiveMark() {
  return (
    <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden>
      <polygon points="15,1 28,8.5 28,25.5 15,33 2,25.5 2,8.5" fill="var(--honey)" />
      <polygon points="15,9 21.5,12.75 21.5,21.25 15,25 8.5,21.25 8.5,12.75" fill="var(--bg-deep)" />
    </svg>
  );
}

function Nav() {
  const path = usePathname();
  const { agents, types, skills, connected } = useHive();
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);
  useEffect(() => { try { const t = localStorage.getItem('hive-theme') as 'light' | 'dark' | null; if (t) { setTheme(t); document.documentElement.dataset.theme = t; } } catch { /* ignore */ } }, []);
  const flip = () => {
    const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem('hive-theme', next); } catch { /* ignore */ }
  };
  const running = agents.filter((a) => a.status === 'running').length;
  const item = (href: string, label: string, icon: ReactNode, count?: number) => {
    const active = href === '/' ? path === '/' : path.startsWith(href);
    return <Link key={href} href={href} className="nav" aria-current={active ? 'page' : undefined}>{icon}<span className="t">{label}</span>{count !== undefined && <span className="count">{count}</span>}</Link>;
  };
  return (
    <nav className="rail" aria-label="Main">
      <div className="brand"><HiveMark /><div>hive-am<small>agent colony manager</small></div></div>
      {item('/', 'Colony', <Hexagon size={18} />, running || undefined)}
      {item('/agents', 'Agents', <Users size={18} />, agents.length)}
      {item('/relations', 'Relations', <Network size={18} />)}
      <div className="nav-label">Library</div>
      {item('/types', 'Agent types', <Boxes size={18} />, types.length)}
      {item('/skills', 'Skills', <Library size={18} />, skills.length)}
      <div className="nav-label">History</div>
      {item('/sessions', 'Sessions', <History size={18} />)}
      <div className="rail-foot">
        <div className="conn"><i className={`dot ${connected ? 'ok' : 'err'}`} />{connected ? 'Connected to server' : 'Server offline — retrying'}</div>
        <button className="btn ghost sm" onClick={flip} style={{ justifyContent: 'flex-start' }}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} Switch theme</button>
      </div>
    </nav>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <HiveProvider>
      <Toaster>
        <div className="shell"><Nav /><main className="main">{children}</main></div>
      </Toaster>
    </HiveProvider>
  );
}
