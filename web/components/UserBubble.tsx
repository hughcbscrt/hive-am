import { Send } from 'lucide-react';
import { parseChannelPrompt } from '@/lib/channel';

/** A user message. Ones that arrived from Telegram/Slack carry a header; they are shown with who wrote them and where. */
export function UserBubble({ text }: { text: string }) {
  const ch = parseChannelPrompt(text);
  if (!ch) return <div className="msg user"><div className="bubble">{text}</div></div>;
  return (
    <div className="msg user">
      <div className="bubble channel">
        <div className="chhead"><Send size={12} aria-hidden /><b>{ch.platform}</b><span>{ch.place}</span><span className="chfrom">{ch.from.replace(/\s*\(.*\)$/, '')}</span></div>
        <div className="chbody">{ch.body}</div>
      </div>
    </div>
  );
}
