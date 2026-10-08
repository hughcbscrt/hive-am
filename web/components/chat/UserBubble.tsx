import { Ear, Send } from 'lucide-react';
import { parseChannelPrompt } from '@/lib/channel';
import { useI18n } from '@/lib/i18n/index';

/** A user message. Ones that arrived from Telegram/Slack carry a header; they are shown with who wrote them and where. */
export function UserBubble({ text }: { text: string }) {
  const { t } = useI18n();
  const ch = parseChannelPrompt(text);
  if (!ch) return <div className="msg user"><div className="bubble">{text}</div></div>;
  return (
    <div className="msg user">
      <div className="bubble channel">
        <div className="chhead"><Send size={12} aria-hidden /><b>{ch.platform}</b><span>{ch.place}</span>{ch.overheard && <span className="chtag" title={t('chat.channel.overheard.hint')}><Ear size={11} aria-hidden />{t('chat.channel.overheard')}</span>}<span className="chfrom">{ch.from.replace(/\s*\(.*\)$/, '')}</span></div>
        <div className="chbody">{ch.body}</div>
        {ch.context && <details className="chctx"><summary>{t('chat.channel.context', { n: ch.context.split('\n').filter((l) => l.startsWith('- ')).length })}</summary><pre>{ch.context.replace(/^[^\n]*\n/, '')}</pre></details>}
      </div>
    </div>
  );
}
