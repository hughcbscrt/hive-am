'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Plus } from 'lucide-react';
import { useHiveData } from '@/lib/store';
import { readStored } from '@/lib/hooks/usePersistentState';
import { LAST_CHAT } from '@/lib/lastChat';
import { Banner, EmptyState } from '@/components/ui';
import { NewAgentDrawer } from '@/components/agents/NewAgentDrawer';
import { useI18n } from '@/lib/i18n';

/** Where the Chat entry lands when there is no agent to talk to yet; with agents it goes straight to the last conversation. */
export default function ChatHome() {
  const { t } = useI18n();
  const { agents, ready, error, retry } = useHiveData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!ready || agents.length === 0) return;
    const last = readStored<string>(LAST_CHAT, '');
    router.replace(`/agents/${agents.some((a) => a.id === last) ? last : agents[0].id}`);
  }, [ready, agents, router]);
  return (
    <div className="page">
      <div className="page-head"><div><h1>{t('nav.chat')}</h1><p>{t('chat.home.subtitle')}</p></div></div>
      {!ready && error && <Banner kind="err"><div className="row gap-s wrap"><span className="grow">{t('cx.loadFailed')} {error}</span><button className="btn sm" onClick={() => void retry()}>{t('cx.retry')}</button></div></Banner>}
      {ready && agents.length === 0 && (
        <EmptyState icon={<MessageSquare size={28} />} title={t('chat.home.empty.title')} body={t('chat.home.empty.body')}
          action={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} />{t('newAgent.create')}</button>} />
      )}
      {creating && <NewAgentDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}
