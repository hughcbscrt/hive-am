'use client';
import { useState } from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/en';

/** What the Slack app needs: keep in step with `server/src/connections/slack.ts` and the manual (chapter 9). */
const BOT_SCOPES: [string, MessageKey][] = [
  ['app_mentions:read', 'conn.slack.scope.mentions'],
  ['channels:history', 'conn.slack.scope.channelsHistory'],
  ['groups:history', 'conn.slack.scope.groupsHistory'],
  ['im:history', 'conn.slack.scope.imHistory'],
  ['mpim:history', 'conn.slack.scope.mpimHistory'],
  ['chat:write', 'conn.slack.scope.chatWrite'],
  ['reactions:write', 'conn.slack.scope.reactions'],
  ['files:read', 'conn.slack.scope.filesRead'],
  ['files:write', 'conn.slack.scope.filesWrite'],
  ['users:read', 'conn.slack.scope.users'],
  ['channels:read', 'conn.slack.scope.channelsRead'],
  ['groups:read', 'conn.slack.scope.groupsRead'],
];
const BOT_EVENTS = ['app_mention', 'message.channels', 'message.groups', 'message.im', 'message.mpim'];

/** A Slack app manifest with all of the above: "Create New App → From an app manifest" sets everything but the app-level token. */
function manifest(name: string): string {
  const display = (name.trim() || 'hive-am').slice(0, 35);
  return JSON.stringify({
    display_information: { name: display, description: 'A hive-am agent' },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: display, always_online: true },
      slash_commands: [{ command: '/hive', description: 'hive-am: status, stop, new, mute, unmute, help, id', usage_hint: 'status', should_escape: false }],
    },
    oauth_config: { scopes: { bot: BOT_SCOPES.map(([s]) => s) } },
    settings: { event_subscriptions: { bot_events: BOT_EVENTS }, interactivity: { is_enabled: false }, org_deploy_enabled: false, socket_mode_enabled: true, token_rotation_enabled: false },
  }, null, 2);
}

/** Everything the Slack app must have for the connection to work, with what each permission is for and a manifest to create it in one go. */
export function SlackSetup({ name, open }: { name: string; open: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(manifest(name)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard: the list below still says everything */ }
  };
  return (
    <details className="fold slack-setup" open={open}>
      <summary>{t('conn.slack.setup.title')}<ChevronRight size={14} className="chev" /></summary>
      <div className="ss-body stack-s">
        <p className="hint m0">{t('conn.slack.setup.intro')}</p>
        <div><button type="button" className="btn sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{t(copied ? 'conn.slack.setup.copied' : 'conn.slack.setup.copy')}</button></div>
        <p className="hint m0">{t('conn.slack.setup.manifestHint')}</p>

        <div className="eyebrow">{t('conn.slack.setup.socket')}</div>
        <p className="hint m0">{t('conn.slack.setup.socketHint')}</p>

        <div className="eyebrow">{t('conn.slack.setup.scopes')}</div>
        <ul className="ss-list">
          {BOT_SCOPES.map(([scope, why]) => <li key={scope}><code>{scope}</code><span className="hint">{t(why)}</span></li>)}
        </ul>

        <div className="eyebrow">{t('conn.slack.setup.events')}</div>
        <p className="hint m0">{BOT_EVENTS.map((e, i) => <span key={e}>{i ? ', ' : ''}<code>{e}</code></span>)}. {t('conn.slack.setup.eventsHint')}</p>

        <div className="eyebrow">{t('conn.slack.setup.more')}</div>
        <ul className="ss-list">
          <li><code>/hive</code><span className="hint">{t('conn.slack.setup.command')}</span></li>
          <li><code>App Home</code><span className="hint">{t('conn.slack.setup.home')}</span></li>
          <li><code>/invite</code><span className="hint">{t('conn.slack.setup.invite')}</span></li>
        </ul>
        <p className="hint m0"><b>{t('conn.slack.setup.reinstall')}</b></p>
      </div>
    </details>
  );
}
