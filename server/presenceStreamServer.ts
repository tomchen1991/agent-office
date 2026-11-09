import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import type { EventEmitter } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createPresenceSeatAllocator, normalizePresence } from './presenceProxy.ts';

export const PRESENCE_STREAM_PATH = '/api/office/presence/ws';
export interface PresenceStreamOptions {
  hosts: readonly string[];
  origins: readonly string[];
  /** Test seams; production always uses the fixed collector endpoint. */
  openUpstream?: (token: string) => WebSocket;
  readConfig?: () => Promise<any>;
  monotonicNow?: () => number;
}
type DTO = ReturnType<typeof normalizePresence>;
type Session = { socket?: WebSocket; watchdog?: ReturnType<typeof setTimeout>; sequence: number; processId?: string };
type Viewer = { sequence: number; sending: boolean; deadline?: ReturnType<typeof setTimeout> };

/** One authorized machine stream shared by all viewers; no raw collector fields cross this boundary. */
export function attachPresenceStream(server: Pick<EventEmitter, 'on' | 'off'>, options: PresenceStreamOptions) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const viewers = new Map<WebSocket, Viewer>();
  const now = options.monotonicNow ?? (() => performance.now());
  let session: Session | undefined;
  let cached: { dto: DTO; receivedAt: number } | undefined;
  const closeViewer = (viewer: WebSocket, code: number) => {
    const state = viewers.get(viewer);
    if (state) clearTimeout(state.deadline);
    viewers.delete(viewer);
    if (viewer.readyState === WebSocket.OPEN) viewer.close(code, 'Presence stream disconnected');
    const timer = setTimeout(() => viewer.terminate(), 1000); timer.unref();
    viewer.once('close', () => clearTimeout(timer));
  };
  const stopUpstream = () => {
    const previous = session;
    session = undefined; cached = undefined;
    clearTimeout(previous?.watchdog);
    previous?.socket?.terminate();
  };
  const fail = (current: Session, code = 1011) => {
    if (session !== current) return;
    stopUpstream();
    for (const viewer of viewers.keys()) closeViewer(viewer, code);
  };
  const send = (viewer: WebSocket, dto: DTO, reason: string) => {
    const state = viewers.get(viewer);
    if (!state) return;
    if (viewer.readyState !== WebSocket.OPEN || state.sending || viewer.bufferedAmount > 1048576) return closeViewer(viewer, 1013);
    const payload = JSON.stringify({ type: 'snapshot', reason: state.sequence === 0 ? 'initial' : reason, sequence: ++state.sequence, ...dto });
    if (Buffer.byteLength(payload) > 1048576) return closeViewer(viewer, 1013);
    state.sending = true;
    state.deadline = setTimeout(() => closeViewer(viewer, 1013), 1000); state.deadline.unref();
    viewer.send(payload, error => {
      clearTimeout(state.deadline); state.sending = false;
      if (error) closeViewer(viewer, 1011);
    });
  };
  const start = () => {
    if (session) return;
    const current: Session = { sequence: 0 };
    session = current;
    const armWatchdog = () => {
      clearTimeout(current.watchdog);
      current.watchdog = setTimeout(() => fail(current), 35000); current.watchdog.unref();
    };
    armWatchdog();
    void (async () => {
      const config = await (options.readConfig?.() ?? readFile(process.env.OFFICE_PRESENCE_CONFIG ?? `${homedir()}/.config/agent-office/presence.json`, 'utf8').then(JSON.parse));
      if (session !== current) return;
      if (config.enabled !== true || typeof config.token !== 'string' || !config.token.trim() || /[\r\n]/.test(config.token)) return fail(current, 4403);
      const upstream = options.openUpstream ? options.openUpstream(config.token) : new WebSocket(
        process.env.OFFICE_PRESENCE_LOOPBACK === '1' ? 'ws://127.0.0.1:18788/api/presence/v1/ws' : 'wss://collect.falsita.cn/api/presence/v1/ws',
        { headers: { Host: 'collect.falsita.cn', Authorization: `Bearer ${config.token}` }, handshakeTimeout: 8000, maxPayload: 1048576, perMessageDeflate: false, followRedirects: false },
      );
      current.socket = upstream;
      const allocateSeats = createPresenceSeatAllocator();
      upstream.on('error', () => fail(current));
      upstream.on('close', () => fail(current));
      upstream.on('unexpected-response', (_req, response) => {
        const code = response.statusCode === 401 || response.statusCode === 403 ? 4403 : response.statusCode === 429 ? 1013 : 1011;
        response.resume(); fail(current, code);
      });
      // ws automatically responds to server ping. Never send application messages or active ping.
      upstream.on('message', (data, binary) => {
        if (session !== current) return;
        try {
          if (binary) throw new Error('contract');
          const frame = JSON.parse(data.toString());
          if (frame.type !== 'snapshot' || !['initial', 'change', 'heartbeat'].includes(frame.reason) || !Number.isSafeInteger(frame.sequence) || frame.sequence !== current.sequence + 1 ||
            (current.sequence === 0 ? frame.reason !== 'initial' : frame.reason === 'initial') ||
            typeof frame.processId !== 'string' || !frame.processId || (current.processId && frame.processId !== current.processId) ||
            frame.heartbeatIntervalMs !== 15000 || frame.staleAfterMs !== 45000 || frame.expireAfterMs !== 600000 || frame.historyLimit !== 10 ||
            !Number.isFinite(Date.parse(frame.startedAt)) || !Number.isFinite(Date.parse(frame.observedAt)) || frame.total !== frame.instances?.length) throw new Error('contract');
          const dto = normalizePresence(frame, config, allocateSeats);
          current.sequence = frame.sequence; current.processId = frame.processId;
          cached = { dto, receivedAt: now() };
          // Each message replaces the full authorized set, including removals and empty lists.
          for (const viewer of viewers.keys()) send(viewer, dto, frame.reason);
          armWatchdog();
        } catch { fail(current); }
      });
    })().catch(() => fail(current));
  };
  const onUpgrade = (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    if (req.url?.split('?')[0] !== PRESENCE_STREAM_PATH) return;
    const reject = (code: number) => { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (req.method !== 'GET' || req.url !== PRESENCE_STREAM_PATH || !options.hosts.includes(req.headers.host ?? '') || !options.origins.includes(req.headers.origin ?? '') || req.headers['sec-websocket-protocol']) return reject(403);
    if (wss.clients.size >= 32) return reject(503);
    wss.handleUpgrade(req, socket, head, viewer => {
      viewers.set(viewer, { sequence: 0, sending: false });
      const departed = () => {
        const state = viewers.get(viewer); clearTimeout(state?.deadline); viewers.delete(viewer);
        if (viewers.size === 0) stopUpstream();
      };
      viewer.on('error', () => { departed(); viewer.terminate(); });
      viewer.on('close', departed);
      viewer.on('message', () => { closeViewer(viewer, 1008); if (viewers.size === 0) stopUpstream(); });
      if (cached) {
        // A new viewer must not renew the age of an old observation just by joining.
        const age = Math.max(0, now() - cached.receivedAt);
        const dto = { ...cached.dto, snapshot: { ...cached.dto.snapshot, agents: cached.dto.snapshot.agents.map(agent => {
          const remaining = Math.max(0, Math.floor((agent.validForMs ?? 0) - age));
          return { ...agent, validForMs: remaining, ...(agent.sourceFreshness === 'fresh' && remaining === 0 ? { sourceFreshness: 'stale' as const, status: 'unknown' as const } : {}) };
        }) } };
        send(viewer, dto, 'initial');
      }
      start();
    });
  };
  server.on('upgrade', onUpgrade);
  return () => {
    server.off('upgrade', onUpgrade); stopUpstream();
    for (const viewer of viewers.keys()) closeViewer(viewer, 1001);
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
}
