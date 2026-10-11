'use client';
import { useState } from 'react';
import { FileText, Info, MoreHorizontal, Play, RefreshCcw, RotateCw, Square, SquareTerminal, Hammer } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/index';
import { fmtBytes } from '@/lib/format';
import type { ServiceStat } from '@/lib/types';
import { useDock } from '@/lib/dock';
import { useToast } from '@/components/ui';
import { Menu, MenuItem } from '@/components/Menu';
import { ServiceDetail } from './ServiceDetail';
import { StatusDot } from './ObjectPanel';

const tone = (s: ServiceStat) => (s.state === 'running' ? (/unhealthy/i.test(s.health) ? 'error' : /starting/i.test(s.health) ? 'starting' : 'running') : s.state === 'exited' || s.state === 'dead' ? 'error' : s.state === 'restarting' ? 'starting' : 'stopped');

/** "16379→6379, 16380→6379": each published port opens on this machine. */
function Ports({ ports }: { ports: string }) {
  const list = ports.split(',').map((p) => p.trim()).filter(Boolean);
  if (!list.length) return <span className="muted">—</span>;
  return <span className="svc-ports">{list.map((p) => { const host = /^(\d+)→/.exec(p)?.[1]; return host ? <a key={p} className="mono" href={`http://localhost:${host}`} target="_blank" rel="noreferrer" title={`http://localhost:${host}`}>{p}</a> : <span key={p} className="mono">{p}</span>; })}</span>;
}

/**
 * The services of a compose project the way Docker Desktop lists them: state, image, ports that open in the browser, what each uses, and
 * start / stop / restart / logs for each one on its own.
 */
export function ServicesTable({ objectId, services, onLogs, onChanged }: { objectId: string; services: ServiceStat[]; onLogs?: (service: string) => void; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const dock = useDock();
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const act = async (service: string, action: 'start' | 'stop' | 'restart' | 'recreate' | 'rebuild') => {
    setBusy(`${service}:${action}`);
    try { await api.post(`/objects/${objectId}/service`, { service, action }); onChanged(); }
    catch (e) { toast(`${t('obj.act.failed', { action: t(`obj.act.${action}`) })}: ${e instanceof Error ? e.message : ''}`, 'err'); }
    finally { setBusy(null); }
  };
  return (<>
    <table className="cm-table svc">
      <thead><tr><th>{t('svc.col.name')}</th><th>{t('svc.col.image')}</th><th>{t('svc.col.status')}</th><th>{t('svc.col.ports')}</th><th className="num">{t('ow.cpu')}</th><th className="num">{t('ow.mem')}</th><th /></tr></thead>
      <tbody>{services.map((s) => {
        const live = s.state === 'running' || s.state === 'restarting';
        return (
          <tr key={s.name}>
            <td><span className="row gap-s"><StatusDot status={tone(s)} /><span className="svc-name"><b>{s.name}</b><small className="mono muted">{s.container}</small></span></span></td>
            <td className="mono small svc-img" title={s.image}>{s.image || '—'}</td>
            <td><span className="small">{s.state}{s.health ? ` · ${s.health}` : ''}</span><div className="muted small">{s.status}</div></td>
            <td><Ports ports={s.ports} /></td>
            <td className="num mono small">{s.cpu !== null ? `${s.cpu}%` : '—'}</td>
            <td className="num mono small">{s.memBytes !== null ? fmtBytes(s.memBytes) : '—'}</td>
            <td className="cm-act">
              <button className="btn ghost icon sm" disabled={!!busy || live} onClick={() => void act(s.name, 'start')} aria-label={t('obj.act.start')} title={t('obj.act.start')}><Play size={14} /></button>
              <button className="btn ghost icon sm" disabled={!!busy || !live} onClick={() => void act(s.name, 'stop')} aria-label={t('obj.act.stop')} title={t('obj.act.stop')}><Square size={14} /></button>
              <button className="btn ghost icon sm" disabled={!!busy} onClick={() => void act(s.name, 'restart')} aria-label={t('obj.act.restart')} title={t('obj.act.restart')}><RotateCw size={14} /></button>
              {onLogs && <button className="btn ghost icon sm" onClick={() => onLogs(s.name)} aria-label={t('svc.logs')} title={t('svc.logs')}><FileText size={14} /></button>}
              <button className="btn ghost icon sm" disabled={!live} onClick={() => void dock.openTerminal({ objectId, service: s.name })} aria-label={t('svc.shell')} title={t('svc.shell')}><SquareTerminal size={14} /></button>
              <Menu label={t('svc.more')} icon={<MoreHorizontal size={14} />} iconOnly>{(close) => (<>
                <MenuItem onClick={() => { close(); setDetail(s.name); }}><span className="row gap-s"><Info size={14} />{t('svc.inspect')}</span></MenuItem>
                <MenuItem onClick={() => { close(); void act(s.name, 'recreate'); }}><span className="row gap-s" title={t('svc.recreate.hint')}><RefreshCcw size={14} />{t('svc.recreate')}</span></MenuItem>
                <MenuItem onClick={() => { close(); void act(s.name, 'rebuild'); }}><span className="row gap-s" title={t('svc.rebuild.hint')}><Hammer size={14} />{t('svc.rebuild')}</span></MenuItem>
              </>)}</Menu>
            </td>
          </tr>);
      })}</tbody>
    </table>
    {detail && <ServiceDetail objectId={objectId} service={detail} title={detail} onClose={() => setDetail(null)} />}
  </>);
}
