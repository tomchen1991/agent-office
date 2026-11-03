/** Node/Electron-main only. Never import this module into the renderer. */
import { versions } from 'node:process';
import type { AdapterState, CharacterId, OfficeAdapter, OfficeAgent, OfficeSnapshot } from '../src/core.ts';

type Timer = ReturnType<typeof setTimeout>;
export interface CollectOptions {
  baseURL: string;
  token: () => string | Promise<string>;
  sourceId?: string;
  identity?: (identity: { sourceId: string; instanceId: string; collectorEpoch: string }) => { name: string; character: CharacterId } | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  pollMs?: number;
  timeoutMs?: number;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid status payload');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new Error('Invalid status field');
  return value;
};
const timestamp = (value: unknown): string => {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid status time');
  return result;
};
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid status count');
  return value;
};
export function normalizeStatus(payload: unknown, options: Pick<CollectOptions, 'identity'>, now: number): OfficeSnapshot {
  const body = object(payload);
  if (body.version !== 1 || body.scope !== 'pi-v1' || body.persistence !== 'memory' || typeof body.storageReady !== 'boolean') throw new Error('Unsupported status contract');
  text(body.processId); // Each successful poll replaces the complete prior snapshot, including after a restart.
  timestamp(body.observedAt);
  const omitted = object(body.coverage).omitted;
  if (typeof omitted !== 'boolean') throw new Error('Invalid coverage flag');
  const total = integer(body.total);
  if (body.nextOffset !== null) integer(body.nextOffset);
  if (!Array.isArray(body.instances) || body.instances.length > 32) throw new Error('Invalid status page');
  const agents: OfficeAgent[] = [];
  const seen = new Set<string>();
  for (const entry of body.instances) {
    const item = object(entry);
    const identity = { sourceId: text(item.sourceId), instanceId: text(item.instanceId), collectorEpoch: text(item.collectorEpoch) };
    if (![1, 2].includes(item.wireVersion as number) || !['connected', 'disconnected'].includes(String(item.connection)) || !['fresh', 'stale', 'unknown'].includes(String(item.freshness)) || !['idle', 'active', 'stopping', 'unknown'].includes(String(item.status))) throw new Error('Invalid instance status');
    const id = JSON.stringify([identity.sourceId, identity.instanceId, identity.collectorEpoch]);
    if (seen.has(id)) continue;
    seen.add(id);
    const configured = options.identity?.(identity);
    const validForMs = integer(item.staleAfterMs);
    if (validForMs === 0) throw new Error('Invalid stale threshold');
    const current = item.connection === 'connected' && item.freshness === 'fresh';
    agents.push({
      id, identity, name: configured?.name ?? '未配置 Agent', character: configured?.character ?? 'unknown',
      status: item.connection === 'disconnected' ? 'offline' : current && item.status === 'active' ? 'working' : current && item.status === 'idle' ? 'idle' : 'unknown',
      latestUserRequest: null,
      // Only server snapshot time is a status observation. Never mix source progress time into freshness.
      observedAt: current && item.snapshotReceivedAt !== null ? timestamp(item.snapshotReceivedAt) : null,
      source: identity.sourceId,
      sourceFreshness: item.connection === 'connected' ? item.freshness as 'fresh' | 'stale' | 'unknown' : 'unknown',
      validForMs,
    });
  }
  return {
    agents, receivedAt: new Date(now).toISOString(),
    identityCoverage: body.nextOffset === null && !omitted && total === agents.length && body.storageReady ? 'complete' : 'partial',
    coverage: `仅当前第一页（${agents.length}/${total}）；${body.nextOffset !== null ? '有后续分页；' : ''}内存保留有限，${omitted ? '存在遗漏' : '未报告遗漏'}。缺席不代表已退出；不提供用户请求摘要或团队关系。`,
  };
}

async function readStatusBody(response: Response): Promise<string> {
  if (!response.body) throw new Error('Missing status body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return result + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 1_048_576) { await reader.cancel(); throw new Error('Status payload too large'); }
      result += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export function createCollectAdapter(options: CollectOptions): OfficeAdapter {
  if (!versions.node || typeof window !== 'undefined') throw new Error('Collect adapter requires Node/Electron main');
  const base = new URL(options.baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid collector URL');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Remote collectors require HTTPS');
  const url = new URL('/v1/status', base);
  url.searchParams.set('limit', '32');
  if (options.sourceId !== undefined) url.searchParams.set('sourceId', text(options.sourceId));
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const pollMs = options.pollMs ?? 5000;
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isFinite(pollMs) || pollMs < 5000 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('Invalid polling interval');
  const listeners = new Set<(state: AdapterState) => void>();
  let state: AdapterState = { phase: 'disconnected', snapshot: null, error: null };
  let generation = 0;
  let active = false;
  let retry: Timer | undefined;
  let request: AbortController | undefined;
  let failures = 0;
  const emit = (next: AdapterState) => { state = next; for (const listener of listeners) listener(state); };
  const disconnectSnapshot = (): OfficeSnapshot | null => state.snapshot ? { ...state.snapshot, identityCoverage: 'unknown', agents: state.snapshot.agents.map(agent => ({ ...agent, status: 'unknown', observedAt: null, sourceFreshness: 'unknown' })) } : null;
  async function poll(current: number) {
    const controller = new AbortController();
    request = controller;
    let timeout: Timer | undefined;
    let retryable = true;
    try {
      const operation = (async () => {
        const token = await options.token();
        if (controller.signal.aborted) throw new Error('Canceled');
        if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Missing consumer token');
        const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'error', cache: 'no-store' });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) retryable = false;
          throw new Error(response.status === 401 || response.status === 403 ? '授权失败，请检查消费者权限后重连。' : response.status === 429 ? '请求限流，正在退避重试。' : '采集服务暂不可用，正在重试。');
        }
        const body = await readStatusBody(response);
        return normalizeStatus(JSON.parse(body), options, now());
      })();
      const expired = new Promise<never>((_, reject) => {
        timeout = setTimer(() => { reject(new Error('采集请求超时，正在重试。')); controller.abort(); }, timeoutMs);
        controller.signal.addEventListener('abort', () => reject(new Error('采集请求已取消。')), { once: true });
      });
      const snapshot = await Promise.race([operation, expired]);
      if (!active || generation !== current) return;
      failures = 0;
      emit({ phase: 'connected', snapshot, error: null });
    } catch (error) {
      if (!active || generation !== current) return;
      failures++;
      // Only fixed local messages cross IPC; never forward fetch errors, URLs, tokens or response bodies.
      const message = error instanceof Error && ['授权失败，请检查消费者权限后重连。', '请求限流，正在退避重试。', '采集服务暂不可用，正在重试。', '采集请求超时，正在重试。'].includes(error.message) ? error.message : '采集数据不可用，正在重试。';
      emit({ phase: 'disconnected', snapshot: disconnectSnapshot(), error: message });
      if (!retryable) active = false;
    } finally {
      if (timeout !== undefined) clearTimer(timeout);
      if (request === controller) request = undefined;
      if (active && generation === current) retry = setTimer(() => { retry = undefined; void poll(current); }, Math.min(60000, pollMs * 2 ** Math.min(failures, 4)));
    }
  }
  return {
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    connect() {
      if (active) return;
      active = true; failures = 0;
      emit({ phase: 'connecting', snapshot: disconnectSnapshot(), error: null });
      void poll(++generation);
    },
    dispose() {
      active = false; generation++;
      if (retry !== undefined) clearTimer(retry);
      retry = undefined;
      request?.abort(); request = undefined;
      emit({ phase: 'disconnected', snapshot: disconnectSnapshot(), error: null });
    },
  };
}
