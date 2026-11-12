import type { PresenceMapping } from './presence.ts';

/** Public source/persona labels only. These values are delivered to every viewer. */
export const PRESENCE_MAPPING: PresenceMapping = {
  sourceCharacters: { 'auto-fix-main': 'github', 'cocoon-main': 'self' },
  sourceLabels: {
    'pi-mac-zijianchen-desk': 'Desk PI',
    'pi-mac-zijianchen-deckz': 'DeckZ PI',
    'pi-vps-cocoon-v2-tty': 'VPS TTY PI',
  },
};

/** Same-origin Nginx relay in production. No token in assets, URL, storage or subprotocol. */
export function presenceWebSocketURL(value = import.meta.env?.VITE_PRESENCE_WS_URL ?? 'wss://office.falsita.cn/api/presence/v1/ws'): URL {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid public collector WebSocket URL');
  }
  return url;
}
