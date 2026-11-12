import type { PresenceMapping } from './presence.ts';

/** Public source/persona labels only. These values are delivered to every viewer. */
export const PRESENCE_MAPPING: PresenceMapping = {
  sourceKinds: { 'get-news-worker': 'hotspot' },
  onDemandSources: {
    'get-news-worker': { name: '热点获取 Agent（Worker）', taskTimeoutMs: 60000 },
  },
};

/** Direct collector connection. No token in assets, URL, storage or subprotocol. */
export function presenceWebSocketURL(value = import.meta.env?.VITE_PRESENCE_WS_URL ?? 'wss://collect.falsita.cn/api/presence/v1/ws'): URL {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid public collector WebSocket URL');
  }
  return url;
}
