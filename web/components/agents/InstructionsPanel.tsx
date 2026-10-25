'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useHiveData } from '@/lib/store';
import { useI18n } from '@/lib/i18n/index';
import { fmtNum } from '@/lib/format';
import { HEAVY_SKILL_SHARE, HEAVY_SKILL_TOKENS, saveDelta } from '@/lib/tokens';
import { Banner } from '@/components/ui';
import type { Agent, InstructionsPart, InstructionsSize, SkillLoad } from '@/lib/types';
import type { AgentDraft } from './AgentForm';

/** A line of the table: one part, or several small ones shown together (identity and the other fixed blocks, aliases and channel). */
interface Row { key: string; label: string; note?: string; chars: number; tokens: number; order: number; skill?: InstructionsPart }

/**
 * What the agent's saved instructions weigh, part by part, heaviest first, so the part to trim is easy to find. Each skill's
 * Always / On demand switch edits the same draft as the Configuration tab (nothing is saved here by itself), and "After saving"
 * estimates the change in the browser from the skills' text, without asking the server.
 */
export function InstructionsPanel({ agent, draft, onChange, dirty }: { agent: Agent; draft: AgentDraft | null; onChange: (d: AgentDraft) => void; dirty: boolean }) {
  const { t } = useI18n();
  const { skills, colonies, connections } = useHiveData();
  const [data, setData] = useState<InstructionsSize | null>(null);
  const [error, setError] = useState('');

  // Measured again whenever something that goes into the instructions changes on the server (a save here, the colony, a skill, a channel).
  const { status: _s, live: _l, queued: _q, session_id: _sid, permission_stale: _ps, ...shape } = agent;
  const sig = JSON.stringify([shape, colonies.find((c) => c.id === agent.colony_id), skills.map((s) => [s.id, s.name, s.description, s.content.length]), connections.filter((c) => c.agent_id === agent.id).map((c) => [c.kind, c.enabled, c.config.aliases])]);
  const load = useCallback(async () => {
    try { setData(await api.get<InstructionsSize>(`/agents/${agent.id}/instructions-size`)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [agent.id]);
  useEffect(() => { void load(); }, [load, sig]);

  const skillOf = (id: string) => skills.find((s) => s.id === id);
  // The agent's own skills, with the mode the draft gives them (or the saved one): a skill from the colony is changed in the colony.
  const own = (id: string) => !!draft && draft.skill_ids.includes(id);
  const modeOf = (id: string, fallback: SkillLoad = 'always'): SkillLoad => (draft && own(id) ? draft.skill_loads[id] ?? skillOf(id)?.load ?? fallback : fallback);
  const setMode = (id: string, mode: SkillLoad) => { if (draft && own(id)) onChange({ ...draft, skill_loads: { ...draft.skill_loads, [id]: mode } }); };

  // What saving would change (`saveDelta`): the agent's own skills in the draft against the saved ones, and the list's header when it comes or goes.
  const delta = useMemo(() => (draft && data ? saveDelta(skills, agent, draft, data) : 0), [draft, data, agent, skills]);

  if (error && !data) return (
    <div className="pane">
      <Banner kind="err" action={<button type="button" className="btn sm" onClick={() => void load()}>{t('fa.retry')}</button>}>{t('ins.error')}</Banner>
    </div>
  );
  if (!data) return (
    <div className="pane ins" aria-busy="true">
      <p className="ins-total">{t('ins.total', { tokens: '…', chars: '…' })}</p>
      <span className="sr-only" role="status">{t('ins.loading')}</span>
      <div className="ins-skel">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" />)}</div>
    </div>
  );

  const rows: Row[] = [];
  const merged = (key: string, label: string, list: InstructionsPart[], note?: string) => {
    if (!list.length) return;
    const chars = list.reduce((n, p) => n + p.chars, 0);
    rows.push({ key, label, note, chars, tokens: Math.ceil(chars / 4), order: data.parts.indexOf(list[0]) });
  };
  data.parts.forEach((p, order) => {
    const row = { key: p.key, chars: p.chars, tokens: p.tokens_est, order };
    if (p.group === 'colony') rows.push({ ...row, label: t('ins.part.colony'), note: p.from_colony ? t('ins.followsColony', { name: p.from_colony }) : undefined });
    else if (p.group === 'own') rows.push({ ...row, label: t('ins.part.own') });
    else if (p.group === 'skill') rows.push({ ...row, label: t('ins.part.skill', { name: p.skill_name ?? '' }), skill: p });
    else if (p.group === 'lazy_list') rows.push({ ...row, label: t('ins.part.lazyList', { count: p.count ?? 0 }) });
    else if (p.group === 'team') rows.push({ ...row, label: t('ins.part.team', { count: p.count ?? 0 }) });
  });
  const channel = data.parts.filter((p) => p.group === 'channel');
  merged('channel', t('ins.part.channel', { name: channel.find((p) => p.channel)?.channel ?? '' }), channel);
  merged('other', t('ins.part.other'), data.parts.filter((p) => p.group === 'identity' || p.group === 'other'));
  rows.sort((a, b) => b.tokens - a.tokens || a.order - b.order);

  const share = (chars: number) => (data.total_chars ? Math.round((chars / data.total_chars) * 100) : 0);
  const toggleable = (p: { skill_id?: string; from_colony?: string }) => !!p.skill_id && !p.from_colony && !data.plan_all && own(p.skill_id);
  // One pointer at most: the heaviest skill the agent can still switch to on demand.
  const heavy = rows.filter((r) => r.skill && toggleable(r.skill) && modeOf(r.skill.skill_id!) === 'always' && r.tokens >= HEAVY_SKILL_TOKENS && share(r.chars) >= HEAVY_SKILL_SHARE)[0];
  const empty = !data.parts.some((p) => ['colony', 'own', 'skill', 'lazy_list'].includes(p.group));

  const modeSwitch = (id: string, name: string, saved: SkillLoad, from?: string) => {
    const can = toggleable({ skill_id: id, from_colony: from });
    const value = can ? modeOf(id, saved) : saved;
    const why = from ? t('ins.fromColony.hint') : data.plan_all ? t('ins.planAll') : undefined;
    return (
      <div className="seg ins-seg" role="group" aria-label={t('ins.mode.group', { name })} title={why}>
        {(['always', 'on_demand'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={value === m} disabled={!can} onClick={() => setMode(id, m)}>{t(m === 'always' ? 'ins.mode.always' : 'ins.mode.lazy')}</button>
        ))}
      </div>
    );
  };
  const unsavedChip = (id: string, saved: SkillLoad) => (toggleable({ skill_id: id }) && modeOf(id, saved) !== saved ? <span className="chip honey">{t('ins.unsavedRow')}</span> : null);
  const fromColony = (name: string) => (
    <span className="hint">{t('ins.fromColony', { name })} · <Link href="/colony">{t('ins.fromColony.edit')}</Link></span>
  );

  return (
    <div className="pane ins">
      <div>
        <p className="ins-total">{t('ins.total', { tokens: fmtNum(data.total_tokens_est), chars: fmtNum(data.total_chars) })}</p>
        <p className="hint m0">{t('ins.estimate')} {t('ins.when')}</p>
      </div>
      {error && <Banner kind="err" action={<button type="button" className="btn sm" onClick={() => void load()}>{t('fa.retry')}</button>}>{t('ins.error')}</Banner>}
      {dirty && <Banner kind="warn">{t('ins.unsaved')}</Banner>}
      {data.plan_all && <Banner kind="info">{t('ins.planAll')}</Banner>}
      {heavy?.skill && (
        <Banner kind="honey" action={<button type="button" className="btn sm" onClick={() => setMode(heavy.skill!.skill_id!, 'on_demand')}>{t('ins.heavy.action')}</button>}>
          {t('ins.heavy', { name: heavy.skill.skill_name ?? '', tokens: fmtNum(heavy.tokens), pct: share(heavy.chars) })}
        </Banner>
      )}
      {empty && <p className="hint m0">{t('ins.empty')}</p>}
      <table className="ins-table">
        <caption className="sr-only">{t('ins.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('ins.col.part')}</th>
            <th scope="col" className="num">{t('ins.col.chars')}</th>
            <th scope="col" className="num">{t('ins.col.tokens')}</th>
            <th scope="col" className="num">{t('ins.col.share')}</th>
            <th scope="col" className="ins-mode">{t('ins.col.mode')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = r.skill, saved = s?.mode ?? 'always';
            return [
              <tr key={r.key} className={s && unsavedChip(s.skill_id!, saved) ? 'changed' : undefined}>
                <th scope="row"><div className="ins-part">
                  <span className="ins-name">{r.label}</span>
                  {s?.from_colony && fromColony(s.from_colony)}
                  {r.note && <span className="hint">{r.note}</span>}
                  {s && unsavedChip(s.skill_id!, saved)}
                  <span className="ins-bar" role="presentation"><span style={{ width: `${share(r.chars)}%` }} /></span>
                </div></th>
                <td className="num">{fmtNum(r.chars)}</td>
                <td className="num">{fmtNum(r.tokens)}</td>
                <td className="num">{share(r.chars)}%</td>
                <td className="ins-mode">{s?.skill_id && modeSwitch(s.skill_id, s.skill_name ?? '', saved, s.from_colony)}</td>
              </tr>,
              // The skills that are only listed hang under the list, so they can be switched back to always.
              ...(r.key === 'lazy_list' ? data.on_demand.map((o) => (
                <tr key={`lazy:${o.skill_id}`} className={`ins-sub${unsavedChip(o.skill_id, 'on_demand') ? ' changed' : ''}`}>
                  <th scope="row"><div className="ins-part">
                    <span className="ins-name">{t('ins.part.skill', { name: o.skill_name })}</span>
                    {o.from_colony && fromColony(o.from_colony)}
                    <span className="hint">{t('ins.inList')}</span>
                    {unsavedChip(o.skill_id, 'on_demand')}
                  </div></th>
                  <td className="num" /><td className="num" /><td className="num" />
                  <td className="ins-mode">{modeSwitch(o.skill_id, o.skill_name, 'on_demand', o.from_colony)}</td>
                </tr>
              )) : []),
            ];
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t('ins.totalRow')}</th>
            <td className="num">{fmtNum(data.total_chars)}</td>
            <td className="num">{fmtNum(data.total_tokens_est)}</td>
            <td className="num" /><td />
          </tr>
          <tr className="ins-notebook">
            <th scope="row"><div className="ins-part">{t('ins.part.notebook')}<span className="hint">{t('ins.notebook.note')}</span></div></th>
            <td className="num">{fmtNum(data.notebook_chars)}</td>
            <td className="num">{fmtNum(data.notebook_tokens_est)}</td>
            <td className="num" /><td />
          </tr>
        </tfoot>
      </table>
      {dirty && delta !== 0 && <p className="ins-after" role="status">{t('ins.afterSave', { count: Math.abs(delta), delta: `${delta < 0 ? '−' : '+'}${fmtNum(Math.abs(delta))}` })}</p>}
    </div>
  );
}
