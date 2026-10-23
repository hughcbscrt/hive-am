'use client';
import { useI18n, type MessageKey } from '@/lib/i18n/index';
import type { DockerPlan } from '@/lib/types';
import { ConfirmDialog } from '@/components/ui';

type T = ReturnType<typeof useI18n>['t'];
/** The name of a setting in the form, for the list of what changes. */
const FIELD: Record<string, MessageKey> = {
  image: 'obj.f.image', ports: 'obj.f.ports', volumes: 'obj.f.volumes', env: 'obj.f.env', restart: 'obj.f.restart', command: 'obj.f.command',
  memory: 'obj.dk.memory', cpus: 'obj.dk.cpus', network: 'obj.dk.network', logMaxMb: 'obj.sup.logMax', stopTimeoutSec: 'obj.sup.stopTimeout',
  labels: 'dk.opts.labels', user: 'dk.opts.user', workdir: 'dk.opts.workdir', entrypoint: 'dk.opts.entrypoint', hostname: 'dk.opts.hostname',
};
export const fieldName = (t: T, field: string) => (FIELD[field] ? t(FIELD[field]) : field);

/** What a toast says once the settings were saved and applied. */
export function applied(t: T, r: { applied: 'nothing' | 'recreated' | 'networks'; connected: string[]; disconnected: string[] }, p: DockerPlan): string {
  if (r.applied === 'nothing') return t('ap.done.nothing');
  if (r.applied === 'recreated') return t('ap.done.recreated');
  const parts = [r.connected.length ? t('ap.done.connected', { names: r.connected.join(', ') }) : '', r.disconnected.length ? t('ap.done.disconnected', { names: r.disconnected.join(', ') }) : ''].filter(Boolean);
  return [t('obj.saved'), ...(parts.length ? parts : [t('ap.done.same')]), ...(p.later.length ? [t('ap.later')] : [])].join(' ');
}

/**
 * The confirmation before a container hive-am created is created again: what changes (and of what kind), what is lost with the old
 * container, the anonymous volumes that stay behind unmounted, and the commands that will run. Nothing is touched until it is confirmed.
 */
export function PlanDialog({ name, plan, onConfirm, onClose }: { name: string; plan: DockerPlan; onConfirm: () => Promise<unknown>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog title={t('ap.title', { name })} body={t(plan.running ? 'ap.body.running' : 'ap.body.stopped')} confirmLabel={t('ap.go')} danger onConfirm={onConfirm} onClose={onClose}>
      <div className="ap">
        <section>
          <div className="eyebrow">{t('ap.changes')}</div>
          {plan.changes.length === 0 && <p className="muted small res-m0">{t('ap.stale')}</p>}
          {plan.changes.length + plan.later.length > 0 && (
            <table className="sd-table ap-table"><tbody>{[...plan.changes.map((c) => ({ ...c, kind: 'recreate' as const })), ...plan.later.map((c) => ({ ...c, kind: 'later' as const }))].map((c) => (
              <tr key={c.field}><th>{fieldName(t, c.field)}</th><td className="mono">{c.from || t('ow.d.none')}<span aria-hidden> → </span>{c.to || t('ow.d.none')}</td><td><span className={`ap-kind ${c.kind}`}>{t(`ap.kind.${c.kind}`)}</span></td></tr>
            ))}</tbody></table>
          )}
          {plan.changes.length > 0 && plan.stale && <p className="muted small res-mt4">{t('ap.staleToo')}</p>}
          <p className="muted small res-mt4">{t('ap.kind.hint')}</p>
        </section>
        <section>
          <div className="eyebrow">{t('ap.lost')}</div>
          <ul className="ap-list"><li>{t('ap.lost.files')}</li><li>{t('ap.lost.logs')}</li><li>{t('ap.lost.ids')}</li></ul>
          <p className="muted small res-mt4">{t('ap.kept')}</p>
        </section>
        {plan.anonymous.length > 0 && (
          <section>
            <div className="eyebrow">{t('ap.anon', { count: plan.anonymous.length })}</div>
            <p className="muted small res-m0">{t('ap.anon.body')}</p>
            <ul className="ap-list mono">{plan.anonymous.map((a) => <li key={a.name}>{a.destination} <span className="muted">· {a.name.slice(0, 12)}</span></li>)}</ul>
          </section>
        )}
        <section>
          <div className="eyebrow">{t('ap.preview')}</div>
          <pre className="ap-preview">{plan.preview.join('\n')}</pre>
        </section>
      </div>
    </ConfirmDialog>
  );
}
