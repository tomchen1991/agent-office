import type { AdapterState, OfficeTopology } from './core';

/** A single live stream; retries never masquerade as new status observations. */
export function connectPresenceStream(
  publish: (next: AdapterState | ((previous: AdapterState) => AdapterState)) => void,
  setTopology: (topology: OfficeTopology) => void,
) {
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
    const url = new URL('/api/office/presence/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let current: WebSocket;
    let sequence = 0;
    const failed = (event?: { code?: number }) => {
      if (stopped || socket !== current) return;
      cancel();
      authorizationFailed = event?.code === 4403;
      publish(previous => ({ ...previous, phase: 'disconnected', error: authorizationFailed ? '状态订阅授权失败，请检查服务端凭证后刷新页面' : '状态连接中断，正在自动重连' }));
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
        const body = JSON.parse(event.data);
        if (body.type !== 'snapshot' || !['initial', 'change', 'heartbeat'].includes(body.reason) || !Number.isSafeInteger(body.sequence) || body.sequence !== sequence + 1 ||
          (sequence === 0 ? body.reason !== 'initial' : body.reason === 'initial') || !body.topology || !Array.isArray(body.snapshot?.agents) || body.snapshot.identityCoverage !== 'complete') throw new Error('contract');
        sequence = body.sequence;
        setTopology(body.topology);
        publish({ phase: 'connected', snapshot: body.snapshot, error: null });
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
