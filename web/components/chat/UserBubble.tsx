import { Clock, Ear, MessageSquare, Paperclip, Send } from 'lucide-react';
import { parseMessage } from '@/lib/git/diffComments';
import { parseChannelPrompt, parseUploads } from '@/lib/channel';
import { useI18n } from '@/lib/i18n/index';

/** A user message. Ones that arrived from Telegram/Slack carry a header; they are shown with who wrote them and where. */
export function UserBubble({ text, badge, agentId }: { text: string; badge?: string; agentId?: string }) {
  const { t } = useI18n();
  const ch = parseChannelPrompt(text);
  const up = !ch ? parseUploads(text) : null;
  const dc = !ch && !up ? parseMessage(text) : null;
  if (up) {
    return (
      <div className={`msg user${badge ? ' queued' : ''}`}>
        <div className="bubble">
          {up.body.trim() && up.body.trim() !== '(no text)' && <div>{up.body.trim()}</div>}
          <div className="bubble-imgs">{up.files.map((f) => {
            const href = agentId ? `/api/agents/${agentId}/inbox?path=${encodeURIComponent(f.path)}` : undefined;
            return agentId && /\.(png|jpe?g|gif|webp)$/i.test(f.path)
              ? <a key={f.path} href={href} target="_blank" rel="noreferrer" title={f.name}><img src={href} alt={f.name} loading="lazy" /></a>
              : <a key={f.path} className="chfile" href={href} download={f.name} title={f.path}><Paperclip size={11} aria-hidden />{f.name}<i>{f.detail.split(', ').pop()}</i></a>;
          })}</div>
        </div>
        {badge && <span className="queued-tag"><Clock size={11} aria-hidden />{badge}</span>}
      </div>
    );
  }
  if (dc) {
    return (
      <div className={`msg user${badge ? ' queued' : ''}`}>
        <div className="bubble diffcard">
          <div className="chhead"><MessageSquare size={12} aria-hidden /><b>{dc.head}</b></div>
          {dc.comments.map((c, i) => (
            <div key={i} className="dcc">
              <div className="dcc-where"><code>{c.path}:{c.range}</code>{c.marks && <span className="chtag">{c.marks}</span>}</div>
              <div className="dcc-text">{c.text}</div>
              <pre className="dcc-code">{c.quote.map((q, j) => <span key={j} className={q[0] === '+' ? 'add' : q[0] === '-' ? 'del' : ''}>{q}{'\n'}</span>)}{c.more && <span className="more">{c.more}</span>}</pre>
            </div>
          ))}
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
