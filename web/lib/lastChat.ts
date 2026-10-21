export const LAST_CHAT = 'hive-am.lastChat';

/** Where "Chat" goes: the last chat opened if that agent still exists, else the first agent, else the chat home. */
export const chatHref = (agents: { id: string }[], lastChat: string): string =>
  agents.some((a) => a.id === lastChat) ? `/agents/${lastChat}` : agents[0] ? `/agents/${agents[0].id}` : '/chat';
