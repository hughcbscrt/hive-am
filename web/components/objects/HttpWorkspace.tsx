'use client';
import { useI18n } from '@/lib/i18n/index';
import type { ObjectView } from '@/lib/types';
import { MasterDetail } from './MasterDetail';
import { NewRequest } from './NewRequest';
import { BatchRun } from './BatchRun';
import { useHttpWorkspace } from './http/useHttpWorkspace';
import { HttpHistoryPane } from './http/HttpHistoryPane';
import { HttpRequestList } from './http/HttpRequestList';
import { HttpResponseView } from './http/HttpResponseView';
import { HttpFileView } from './http/HttpFileView';
import { HttpConfirmDialog } from './http/HttpSessionBlock';

/**
 * The requests of an HTTP object as a screen: the .http files at the left (pick the one you want to try, or run it whole), its requests
 * under it, the session (the values the response handlers keep), and the request with its answer, tests and console on the right.
 */
export function HttpWorkspace({ object: o, onOpenVars, pane = 'requests', onGoRequests }: { object: ObjectView; onOpenVars: () => void; pane?: 'requests' | 'history'; onGoRequests?: () => void }) {
  const { t } = useI18n();
  const ws = useHttpWorkspace(o);
  const { scan, err, env, file, setFile, sel, setSel, picked, batch, setBatch, creating, setCreating, setFileTab, setOpen, load, loadSession, loadHistory } = ws;
  if (err) return <p className="gx-note err hw-pad">{err}</p>;
  if (!scan) return <p className="gx-note">{t('git.loading')}</p>;
  if (pane === 'history') return <HttpHistoryPane ws={ws} scan={scan} onGoRequests={onGoRequests} />;
  return (
    <MasterDetail list={<HttpRequestList ws={ws} scan={scan} onOpenVars={onOpenVars} />}>
      <section className="hr-detail">
        {sel ? <HttpResponseView ws={ws} scan={scan} onOpenVars={onOpenVars} /> : picked ? <HttpFileView ws={ws} picked={picked} /> : <div className="gx-empty"><p>{t('hw.pickFile')}</p></div>}
      </section>
      {batch && picked && <BatchRun objectId={o.id} file={picked} env={env} onClose={() => setBatch(false)} onDone={() => { void loadSession(); void loadHistory(); }} />}
      {creating && <NewRequest objectId={o.id} files={scan.files} defaultFile={file} onClose={() => setCreating(false)} onCreated={(f) => { setCreating(false); setFile(f); setSel(null); setFileTab('source'); setOpen((x) => new Set(x).add(f)); load(); }} />}
      <HttpConfirmDialog ws={ws} />
    </MasterDetail>
  );
}
