'use client';
import { useEffect, useState } from 'react';
import { Plug, Plus, Send } from 'lucide-react';
import { useHive } from '@/lib/store';
import { ago } from '@/lib/meta';
import { useI18n } from '@/lib/i18n';
import type { Connection } from '@/lib/types';
import { Hex } from '@/components/ui';
import { ConnectionDrawer } from '@/components/ConnectionDrawer';

const DOT: Record<Connection['status']['state'], string> = { connected: 'ok', connecting: 'run', error: 'err', stopped: '' };

export default function Connections() {
  const { t } = useI18n();
  const { connections, agents, ready, refresh } = useHive();
  const [editing, setEditing] = useState<Connection | 'new' | null>(null);

  // Status changes on its own (a bad token, a dropped network), so keep it fresh while this page is open.
  useEffect(() => { const i = setInterval(() => void refresh(['connections']), 5000); return () => clearInterval(i); }, [refresh]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('nav.connections')}</h1><p>{t('conn.subtitle')}</p></div>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} />{t('conn.new')}</button>
      </div>

      {ready && connections.length === 0 ? (
        <div className="empty"><Plug size={28} aria-hidden /><h3>{t('conn.empty.title')}</h3><p>{t('conn.empty.body')}</p><button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} />{t('conn.new')}</button></div>
      ) : (
        <div className="conn-grid">
          {connections.map((c) => {
            const agent = agents.find((a) => a.id === c.agent_id);
            return (
              <button key={c.id} type="button" className="card card-pad conncard" onClick={() => setEditing(c)}>
                <div className="row gap-s" style={{ alignItems: 'center' }}>
                  <Send size={16} aria-hidden /><b className="grow" style={{ textAlign: 'left' }}>{c.name}</b>
                  <span className="chip"><i className={`dot ${DOT[c.status.state]}`} />{t(`conn.status.${c.enabled ? c.status.state : 'stopped'}`)}</span>
                </div>
                {c.status.state === 'error' && c.enabled && <p className="small" style={{ margin: 0, color: 'var(--err)', textAlign: 'left' }}>{c.status.detail}</p>}
                <div className="row gap-s" style={{ alignItems: 'center' }}>
                  {agent ? <><Hex agent={agent} size="sm" /><span>{agent.name}</span></> : <span className="muted small">{t('conn.noAgent')}</span>}
                </div>
                <div className="muted small" style={{ textAlign: 'left' }}>
                  {c.kind === 'slack' ? t('conn.kind.slack') : t('conn.kind.telegram')}{c.status.detail && c.status.state === 'connected' ? ` · ${c.status.detail}` : ''} · {t('conn.threads', { count: c.thread_count })}
                  {c.status.lastEventAt ? ` · ${t('conn.lastEvent', { when: ago(c.status.lastEventAt) })}` : ''}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {editing && <ConnectionDrawer connection={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
