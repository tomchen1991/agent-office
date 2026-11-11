import type { AdapterState, OfficeTopology } from './core';
import { createPresenceSeatAllocator, normalizePresence } from './presence.ts';
import { PRESENCE_MAPPING, presenceWebSocketURL } from './presenceConfig.ts';
import type { PresenceMapping } from './presence.ts';

/** Each page owns its direct collector connection and local presentation state. */
export function connectPresenceStream(
  publish: (next: AdapterState | ((previous: AdapterState) => AdapterState)) => void,
  setTopology: (topology: OfficeTopology) => void,
  options: { url?: string; mapping?: PresenceMapping } = {},
) {
  let url: URL;
  try { url = presenceWebSocketURL(options.url); } catch {
    publish(previous => ({ ...previous, phase: 'disconnected', error: '采集服务 WebSocket 地址配置无效' }));
    return () => {};
  }
  // Keep allocation through reconnects, but never share it across pages or subscriptions.
  const allocateSeats = createPresenceSeatAllocator();
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: number | undefined;
  let watchdog: number | undefined;
  let failures = 0;
  let authorizationFailed = false;
  const clearTimers = () => { window.clearTimeout(retry); window.clearTimeout(watchdog); retry = watchdog = undefined; };
  const cancel = () => {
    clearTimers();
    const previous = socket;
    socket = null; // Invalidate callbacks before closing (including Strict Mode cleanup).
    previous?.close();
  };
  const connect = () => {
    if (stopped || authorizationFailed || document.hidden || socket) return;
    clearTimers();
    let current: WebSocket;
    let sequence = 0;
    let processId: string | undefined;
    const failed = (event?: { code?: number }) => {
      if (stopped || socket !== current) return;
      cancel();
      authorizationFailed = event?.code === 4403;
      publish(previous => ({ ...previous, phase: 'disconnected', error: authorizationFailed ? '状态订阅授权失败，请检查采集服务的浏览器访问权限后刷新页面' : '采集服务直连失败，请检查浏览器访问权限或网络，正在自动重连' }));
      if (!authorizationFailed && !document.hidden) retry = window.setTimeout(connect, Math.max(event?.code === 1013 ? 5000 : 1000, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5))));
    };
    try { current = new WebSocket(url); } catch {
      publish(previous => ({ ...previous, phase: 'disconnected', error: '无法建立状态连接，正在自动重连' }));
      retry = window.setTimeout(connect, 30000);
      return;
    }
    socket = current;
    const armWatchdog = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(failed, 35000);
    };
    armWatchdog(); // Bounds handshake and first snapshot, not just an open TCP socket.
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 1048576 || new TextEncoder().encode(event.data).byteLength > 1048576) throw new Error('limit');
        const body = JSON.parse(event.data);
        if (!body || body.type !== 'snapshot' || !['initial', 'change', 'heartbeat'].includes(body.reason) || !Number.isSafeInteger(body.sequence) || body.sequence !== sequence + 1 ||
          (sequence === 0 ? body.reason !== 'initial' : body.reason === 'initial') ||
          typeof body.processId !== 'string' || !body.processId || (processId !== undefined && body.processId !== processId) ||
          body.heartbeatIntervalMs !== 15000 || body.staleAfterMs !== 45000 || body.expireAfterMs !== 600000 || body.historyLimit !== 10 ||
          !Number.isFinite(Date.parse(body.startedAt)) || !Number.isFinite(Date.parse(body.observedAt)) || !Array.isArray(body.instances) || body.total !== body.instances.length) throw new Error('contract');
        const next = normalizePresence(body, options.mapping ?? PRESENCE_MAPPING, allocateSeats);
        sequence = body.sequence;
        processId = body.processId;
        setTopology(next.topology);
        publish({ phase: 'connected', snapshot: next.snapshot, error: null });
        failures = 0;
        armWatchdog();
      } catch { failed(); }
    };
    current.onclose = failed;
    current.onerror = () => failed();
  };
  const resume = () => { if (!socket) connect(); };
  const visibility = () => { if (document.hidden) cancel(); else resume(); };
  const offline = () => {
    cancel();
    publish(previous => ({ ...previous, phase: 'disconnected', error: '网络已断开，恢复后将自动重连' }));
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  window.addEventListener('offline', offline);
  window.addEventListener('pagehide', cancel);
  connect();
  return () => {
    stopped = true;
    cancel();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('online', resume);
    window.removeEventListener('offline', offline);
    window.removeEventListener('pagehide', cancel);
  };
}
