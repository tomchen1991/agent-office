/** Node/Electron-main only. Never import this module into the renderer. */
import { versions } from 'node:process';
import { performance } from 'node:perf_hooks';
import type { AdapterState, CharacterId, OfficeAdapter, OfficeAgent, OfficeSnapshot } from '../src/core.ts';

type Timer = ReturnType<typeof setTimeout>;
export interface CollectOptions {
  baseURL: string;
  token: () => string | Promise<string>;
  sourceId?: string;
  identity?: (identity: { sourceId: string; instanceId: string; collectorEpoch: string }) => { name: string; character: CharacterId } | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  /** Local elapsed time only; never compare this with a server timestamp. */
  monotonicNow?: () => number;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  pollMs?: number;
  /** Bounds token acquisition, all pages and body reads together. */
  timeoutMs?: number;
}
const PAGE_LIMIT = 32;
const MAX_OFFSET = 1280;
const MAX_PAGES = Math.floor(MAX_OFFSET / PAGE_LIMIT) + 1;
const MAX_BODY_BYTES = 1_048_576;
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
interface StatusPage {
  processId: string;
  startedAt: string;
  observedAt: number;
  total: number;
  omitted: boolean;
  storageReady: boolean;
  nextOffset: number | null;
  agents: OfficeAgent[];
}
function normalizePage(payload: unknown, options: Pick<CollectOptions, 'identity'>): StatusPage {
  const body = object(payload);
  if (body.version !== 1 || body.scope !== 'pi-v1' || body.persistence !== 'memory' || typeof body.storageReady !== 'boolean') throw new Error('Unsupported status contract');
  const processId = text(body.processId);
  const startedAt = timestamp(body.startedAt);
  const observedAt = Date.parse(timestamp(body.observedAt));
  const omitted = object(body.coverage).omitted;
  if (typeof omitted !== 'boolean') throw new Error('Invalid coverage flag');
  const total = integer(body.total);
  const nextOffset = body.nextOffset === null ? null : integer(body.nextOffset);
  if (nextOffset !== null && (nextOffset === 0 || nextOffset > MAX_OFFSET)) throw new Error('Invalid status cursor');
  if (!Array.isArray(body.instances) || body.instances.length > PAGE_LIMIT) throw new Error('Invalid status page');
  const agents = new Map<string, OfficeAgent>();
  for (const entry of body.instances) {
    const item = object(entry);
    const identity = { sourceId: text(item.sourceId), instanceId: text(item.instanceId), collectorEpoch: text(item.collectorEpoch) };
    if (![1, 2].includes(item.wireVersion as number) || !['connected', 'disconnected'].includes(String(item.connection)) || !['fresh', 'stale', 'unknown'].includes(String(item.freshness)) || !['idle', 'active', 'stopping', 'unknown'].includes(String(item.status))) throw new Error('Invalid instance status');
    const id = JSON.stringify([identity.sourceId, identity.instanceId, identity.collectorEpoch]);
    const configured = options.identity?.(identity);
    const validForMs = integer(item.staleAfterMs);
    if (validForMs === 0) throw new Error('Invalid stale threshold');
    const snapshotReceivedAt = item.snapshotReceivedAt === null ? null : timestamp(item.snapshotReceivedAt);
    const current = item.connection === 'connected' && item.freshness === 'fresh';
    // A later duplicate carries the latest observation, but never creates a second identity.
    agents.set(id, {
      id, identity, name: configured?.name ?? '未配置 Agent', character: configured?.character ?? 'unknown',
      status: item.connection === 'disconnected' ? 'offline' : current && item.status === 'active' ? 'working' : current && item.status === 'idle' ? 'idle' : current && item.status === 'stopping' ? 'stopping' : 'unknown',
      latestUserRequest: null,
      // Only server snapshot time is a status observation. Never mix source progress time into freshness.
      observedAt: current ? snapshotReceivedAt : null,
      source: identity.sourceId,
      sourceFreshness: item.connection === 'connected' ? item.freshness as 'fresh' | 'stale' | 'unknown' : 'unknown',
      validForMs,
    });
  }
  return { processId, startedAt, observedAt, total, omitted, storageReady: body.storageReady, nextOffset, agents: [...agents.values()] };
}
interface CollectedPage { page: StatusPage; receivedAt: number }
function snapshotFromPages(pages: readonly CollectedPage[], now: number, receivedAt: number): OfficeSnapshot {
  const agents = new Map<string, OfficeAgent>();
  for (const entry of pages) {
    const age = Math.max(0, receivedAt - entry.receivedAt);
    for (const agent of entry.page.agents) {
      // The walk itself consumes the fresh window. Server freshness stays authoritative;
      // only local elapsed time since this page arrived ages an otherwise fresh record.
      const remaining = Math.max(0, Math.floor(agent.validForMs! - age));
      agents.set(agent.id, agent.sourceFreshness === 'fresh' ? remaining === 0
        ? { ...agent, status: 'unknown', sourceFreshness: 'stale' }
        : { ...agent, validForMs: remaining } : agent);
    }
  }
  const last = pages[pages.length - 1].page;
  const omitted = pages.some(({ page }) => page.omitted);
  const storageReady = pages.every(({ page }) => page.storageReady);
  const nonAtomic = pages.length > 1;
  const totalChanged = pages.some(({ page }) => page.total !== last.total);
  return {
    agents: [...agents.values()], receivedAt: new Date(now).toISOString(),
    // Offset pagination has no snapshot token: matching totals do not prove uniqueness.
    identityCoverage: !nonAtomic && last.nextOffset === null && !omitted && last.total === agents.size && storageReady ? 'complete' : 'partial',
    coverage: `已读取 ${pages.length} 页，去重后 ${agents.size} 个实例（服务报告总数 ${last.total}）；${nonAtomic ? '非原子分页，身份覆盖仍为部分；' : '单页；'}${last.nextOffset !== null ? '有后续分页尚未读取；' : '已到当前分页末尾；'}${totalChanged ? '分页期间总数发生变化；' : ''}${storageReady ? '' : '存储未就绪；'}内存保留有限，${omitted ? '存在遗漏' : '未报告遗漏'}。缺席不代表已退出；不提供用户请求摘要、团队关系或模型身份。`,
  };
}
/** Normalize one standalone page. The adapter below walks every page before publishing. */
export function normalizeStatus(payload: unknown, options: Pick<CollectOptions, 'identity'>, now: number): OfficeSnapshot {
  return snapshotFromPages([{ page: normalizePage(payload, options), receivedAt: 0 }], now, 0);
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Canceled');
}
async function readStatusBody(response: Response, signal: AbortSignal): Promise<string> {
  assertNotAborted(signal);
  if (!response.body) throw new Error('Missing status body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      assertNotAborted(signal);
      const { done, value } = await reader.read();
      assertNotAborted(signal);
      if (done) return result + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('Status payload too large'); }
      result += decoder.decode(value, { stream: true });
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

export function createCollectAdapter(options: CollectOptions): OfficeAdapter {
  if (!versions.node || typeof window !== 'undefined') throw new Error('Collect adapter requires Node/Electron main');
  const base = new URL(options.baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid collector URL');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Remote collectors require HTTPS');
  const url = new URL('/v1/status', base);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (options.sourceId !== undefined) url.searchParams.set('sourceId', text(options.sourceId));
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
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
  let requestTimeout: Timer | undefined;
  let failures = 0;
  const emit = (next: AdapterState) => { state = next; for (const listener of listeners) listener(state); };
  const disconnectSnapshot = (): OfficeSnapshot | null => state.snapshot ? { ...state.snapshot, identityCoverage: 'unknown', agents: state.snapshot.agents.map(agent => ({ ...agent, status: 'unknown', observedAt: null, sourceFreshness: 'unknown' })) } : null;
  async function poll(current: number) {
    const controller = new AbortController();
    request = controller;
    let timeout: Timer | undefined;
    let onAbort: (() => void) | undefined;
    let retryable = true;
    try {
      const operation = (async () => {
        const token = await options.token();
        assertNotAborted(controller.signal);
        if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('Missing consumer token');
        const pages: CollectedPage[] = [];
        const offsets = new Set<number>();
        let offset = 0;
        while (true) {
          assertNotAborted(controller.signal);
          if (pages.length >= MAX_PAGES || offsets.has(offset)) throw new Error('Invalid status pagination');
          offsets.add(offset);
          const pageURL = new URL(url);
          // Omit the default first offset; subsequent URLs contain each allowed key exactly once.
          if (offset !== 0) pageURL.searchParams.set('offset', String(offset));
          const response = await fetcher(pageURL, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'error', cache: 'no-store' });
          if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
          assertNotAborted(controller.signal);
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            if (response.status === 401 || response.status === 403) retryable = false;
            throw new Error(response.status === 401 || response.status === 403 ? '授权失败，请检查消费者权限后重连。' : response.status === 429 ? '请求限流，正在退避重试。' : '采集服务暂不可用，正在重试。');
          }
          const body = await readStatusBody(response, controller.signal);
          assertNotAborted(controller.signal);
          const page = normalizePage(JSON.parse(body), options);
          const previous = pages.at(-1);
          const receivedAt = monotonicNow();
          if (!Number.isFinite(receivedAt) || (previous && receivedAt < previous.receivedAt)) throw new Error('Invalid local elapsed time');
          if (previous && (page.processId !== previous.page.processId || Date.parse(page.startedAt) !== Date.parse(previous.page.startedAt) || page.observedAt < previous.page.observedAt)) throw new Error('Status process or time changed during pagination');
          if (page.nextOffset !== null && (page.nextOffset <= offset || offsets.has(page.nextOffset))) throw new Error('Status cursor did not advance');
          pages.push({ page, receivedAt });
          if (page.nextOffset === null) {
            const completedAt = monotonicNow();
            if (!Number.isFinite(completedAt) || completedAt < receivedAt) throw new Error('Invalid local elapsed time');
            return snapshotFromPages(pages, now(), completedAt);
          }
          offset = page.nextOffset;
        }
      })();
      const expired = new Promise<never>((_, reject) => {
        timeout = setTimer(() => { reject(new Error('采集请求超时，正在重试。')); controller.abort(); }, timeoutMs);
        requestTimeout = timeout;
        onAbort = () => reject(new Error('采集请求已取消。'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
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
      if (requestTimeout === timeout) requestTimeout = undefined;
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
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
      if (requestTimeout !== undefined) clearTimer(requestTimeout);
      requestTimeout = undefined;
      request?.abort(); request = undefined;
      emit({ phase: 'disconnected', snapshot: disconnectSnapshot(), error: null });
    },
  };
}
