import { Clock, Ear, Paperclip, Send } from 'lucide-react';
import { parseChannelPrompt, parseUploads } from '@/lib/channel';
import { useI18n } from '@/lib/i18n/index';

/** A user message. Ones that arrived from Telegram/Slack carry a header; they are shown with who wrote them and where. */
export function UserBubble({ text, badge, agentId }: { text: string; badge?: string; agentId?: string }) {
  const { t } = useI18n();
  const ch = parseChannelPrompt(text);
  const up = !ch ? parseUploads(text) : null;
  if (up) {
    return (
      <div className={`msg user${badge ? ' queued' : ''}`}>
        <div className="bubble">
          {up.body.trim() && up.body.trim() !== '(no text)' && <div>{up.body.trim()}</div>}
          <div className="bubble-imgs">{up.files.map((f) => agentId
            ? <a key={f.path} href={`/api/agents/${agentId}/inbox?path=${encodeURIComponent(f.path)}`} target="_blank" rel="noreferrer" title={f.name}><img src={`/api/agents/${agentId}/inbox?path=${encodeURIComponent(f.path)}`} alt={f.name} loading="lazy" /></a>
            : <span key={f.path} className="chfile" title={f.path}><Paperclip size={11} aria-hidden />{f.name}</span>)}</div>
        </div>
        {badge && <span className="queued-tag"><Clock size={11} aria-hidden />{badge}</span>}
      </div>
    );
  }
  if (!ch) return <div className={`msg user${badge ? ' queued' : ''}`}><div className="bubble">{text}</div>{badge && <span className="queued-tag"><Clock size={11} aria-hidden />{badge}</span>}</div>;
  return (
    <div className="msg user">
      <div className="bubble channel">
        <div className="chhead"><Send size={12} aria-hidden /><b>{ch.platform}</b><span>{ch.place}</span>{ch.overheard && <span className="chtag" title={t('chat.channel.overheard.hint')}><Ear size={11} aria-hidden />{t('chat.channel.overheard')}</span>}<span className="chfrom">{ch.from.replace(/\s*\(.*\)$/, '')}</span></div>
        <div className="chbody">{ch.body}</div>
        {ch.files.length > 0 && <div className="chfiles">{ch.files.map((f) => <span key={f.path} className="chfile" title={f.path}><Paperclip size={11} aria-hidden />{f.name}<i>{f.detail.split(', ').pop()}</i></span>)}</div>}
        {ch.context && <details className="chctx"><summary>{t('chat.channel.context', { n: ch.context.split('\n').filter((l) => l.startsWith('- ')).length })}</summary><pre>{ch.context.replace(/^[^\n]*\n/, '')}</pre></details>}
      </div>
    </div>
  );
}
