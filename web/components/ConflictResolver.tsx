'use client';
import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { applyChoice, parseConflicts, type Choice } from '@/lib/conflicts';
import type { Agent, GitFileResult } from '@/lib/types';
import type { GitActions } from './GitActions';
import { CopyBtn } from './ToolCall';
import { CodeEditor } from './CodeEditor';
import { Code } from './Code';

/**
 * Resolve one conflicted file. The text below ("Result") is the single source of truth and is always editable:
 * each conflict card only rewrites its own block in that text, so any combination of mine / remote / both can be
 * mixed and then fixed by hand (for example if "both" leaves repeated code).
 * In a rebase git swaps the sides, so "mine" is whichever side holds your own commits.
 */
export function ConflictResolver({ agent, path, state, a, onResolved }: { agent: Agent; path: string; state: 'merge' | 'rebase' | null; a: GitActions; onResolved: () => void }) {
  const { t } = useI18n();
  const [file, setFile] = useState<GitFileResult | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [load, setLoad] = useState(0);

  useEffect(() => {
    let dead = false; setFile(null); setErr(null);
    api.get<GitFileResult>(`/agents/${agent.id}/git/file?path=${encodeURIComponent(path)}`)
      .then((f) => { if (dead) return; setFile(f); setText(f.content); })
      .catch((e) => !dead && setErr(e instanceof Error ? e.message : t('git.loadError')));
    return () => { dead = true; };
  }, [agent.id, path, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocks = useMemo(() => parseConflicts(text), [text]);
  const mineIsOurs = state !== 'rebase';
  const side = (b: 'mine' | 'remote'): 'ours' | 'theirs' => ((b === 'mine') === mineIsOurs ? 'ours' : 'theirs');
  const text_ = (c: 'mine' | 'remote' | 'both-mine' | 'both-remote'): Choice =>
    c === 'both-mine' ? (mineIsOurs ? 'ours-theirs' : 'theirs-ours') : c === 'both-remote' ? (mineIsOurs ? 'theirs-ours' : 'ours-theirs') : side(c);
  const stillMarked = /^(<{7}|>{7})( |$)/m.test(text);
  const editable = !!file && !file.binary && !file.truncated;
  const busy = !!a.busy;

  const wholeFile = async (s: 'mine' | 'remote') => { if (await a.run('resolve', t('git.res.done'), 'resolve-side', { path, side: side(s) })) onResolved(); };
  const save = async () => { if (await a.run('resolve', t('git.res.done'), 'resolve', { path, content: text })) onResolved(); };
  const restore = async () => { if (await a.run('unresolve', t('git.res.restored'), 'unresolve', { path })) setLoad((n) => n + 1); };

  const slash = path.lastIndexOf('/'); const dir = slash >= 0 ? path.slice(0, slash + 1) : ''; const name = path.slice(slash + 1);
  const label = (l: string) => (!l || l === 'HEAD' || l === 'ours' || l === 'theirs' ? '' : l);

  return (
    <section className="gx-preview gx-resolver" aria-label={path}>
      <header className="gx-phead">
        <div className="gx-ptitle">
          <span className="gx-path mono" title={path}><span className="dir">{dir}</span><b>{name}</b></span>
          <span className="gx-chip st-conflict">{t('git.status.conflict')}</span>
          {editable && <span className="muted small">{blocks.length > 0 ? t('git.res.left', { count: blocks.length }) : t('git.res.none')}</span>}
        </div>
        <div className="gx-ptools">
          <button className="btn sm" disabled={busy} title={t('git.res.allMine.hint')} onClick={() => void wholeFile('mine')}>{t('git.res.allMine')}</button>
          <button className="btn sm" disabled={busy} title={t('git.res.allRemote.hint')} onClick={() => void wholeFile('remote')}>{t('git.res.allRemote')}</button>
          <CopyBtn text={path} label={t('git.copyPath')} />
        </div>
      </header>

      {err ? <p className="gx-note err">{err}</p> : !file ? <p className="gx-note">{t('git.loading')}</p> : !editable ? <p className="gx-note">{t('git.res.noEdit')}</p> : (
        <div className="gx-rbody">
          {blocks.length > 0 && (
            <div className="gx-rblocks">
              {blocks.map((b, i) => (
                <div key={`${i}-${b.start}`} className="gx-rcard">
                  <div className="gx-rtitle"><b>{t('git.res.block', { n: i + 1, total: blocks.length })}</b><span className="muted small">{t('git.res.line', { n: b.start + 1 })}</span></div>
                  <div className="gx-rsides">
                    {(['mine', 'remote'] as const).map((who) => {
                      const lines = side(who) === 'ours' ? b.ours : b.theirs; const lbl = label(side(who) === 'ours' ? b.oursLabel : b.theirsLabel);
                      return (
                        <div key={who} className={`gx-rside ${who}`}>
                          <div className="gx-rhead"><span>{who === 'mine' ? t('git.res.mine') : t('git.res.remote')}</span>{lbl && <i className="ref">{lbl}</i>}</div>
                          <pre>{lines.length ? <Code text={lines.join('\n')} path={path} /> : <span className="muted">{t('git.res.empty')}</span>}</pre>
                          <button className="btn sm" onClick={() => setText((x) => applyChoice(x, i, text_(who)))}>{who === 'mine' ? t('git.res.keepMine') : t('git.res.keepRemote')}</button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="gx-rboth">
                    <span className="small muted">{t('git.res.both')}:</span>
                    <button className="btn sm" onClick={() => setText((x) => applyChoice(x, i, text_('both-mine')))}>{t('git.res.bothMine')}</button>
                    <button className="btn sm" onClick={() => setText((x) => applyChoice(x, i, text_('both-remote')))}>{t('git.res.bothRemote')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="gx-rresult">
            <div className="row"><label className="label grow" htmlFor="gx-result">{t('git.res.result')}</label><span className="small muted">{t('git.res.editHint')}</span></div>
            <CodeEditor id="gx-result" label={t('git.res.result')} value={text} path={path} onChange={setText} />
          </div>
          <footer className="gx-rfoot">
            <button className="btn ghost sm" disabled={busy} onClick={() => void restore()} title={t('git.res.restore.hint')}><RotateCcw size={14} />{t('git.res.restore')}</button>
            <span className="grow" />
            <button className="btn primary" disabled={busy || stillMarked} onClick={() => void save()}>{t('git.res.markResolved')}</button>
          </footer>
        </div>
      )}
    </section>
  );
}
