import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { attachPresenceStream } from '../server/presenceStreamServer.ts';

const frame = (reason = 'initial', sequence = 1) => ({
  version: 1, type: 'snapshot', reason, sequence, persistence: 'memory', complete: true, processId: 'synthetic-process', staleAfterMs: 45000,
  startedAt: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:00Z', heartbeatIntervalMs: 15000, expireAfterMs: 600000, historyLimit: 10, total: 1,
  instances: [{ sourceId: 'fixture', instanceId: 'agent', status: 'working', freshness: 'fresh', ageMs: 100,
    receivedAt: '2026-01-01T00:00:00Z', data: { instance_id: 'agent', member_name: 'Synthetic agent', provider: 'openai', model: 'fixture-model', private_field: 'must-not-leak' } }],
});

async function fixture(rejectStatus?: number) {
  let clock = 0;
  const upstreamServer = createServer();
  const upstreamWss = new WebSocketServer(rejectStatus ? { noServer: true } : { server: upstreamServer });
  if (rejectStatus) upstreamServer.on('upgrade', (_req, socket) => socket.end(`HTTP/1.1 ${rejectStatus} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`));
  upstreamServer.listen(0, '127.0.0.1'); await once(upstreamServer, 'listening');
  const upstreamPort = (upstreamServer.address() as import('node:net').AddressInfo).port;
  const server = createServer();
  let configReads = 0;
  const dispose = attachPresenceStream(server, {
    hosts: ['office.fixture'], origins: ['https://office.fixture'], monotonicNow: () => clock,
    readConfig: async () => { configReads++; return { enabled: true, token: 'synthetic-token' }; },
    openUpstream: token => new WebSocket(`ws://127.0.0.1:${upstreamPort}`, { headers: { Authorization: `Bearer ${token}` } }),
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as import('node:net').AddressInfo).port;
  return {
    upstreamWss, configReads: () => configReads, advance: (ms: number) => { clock += ms; },
    connect: (path = '/api/office/presence/ws', origin = 'https://office.fixture') => new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { Host: 'office.fixture', Origin: origin } }),
    async close() {
      dispose();
      for (const client of upstreamWss.clients) client.terminate();
      upstreamWss.close();
      await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstreamServer.close(() => resolve()))]);
    },
  };
}

test('WS proxy forwards only normalized DTOs, including full change/heartbeat state, and closes upstream on viewer departure', async () => {
  const f = await fixture();
  try {
    const connected = once(f.upstreamWss, 'connection');
    const viewer = f.connect(); await once(viewer, 'open');
    const [upstream, req] = await connected as [WebSocket, import('node:http').IncomingMessage];
    assert.equal(req.headers.authorization, 'Bearer synthetic-token');
    assert.equal(req.headers.origin, undefined); assert.equal(req.headers.cookie, undefined);
    let sequence = 0;
    for (const reason of ['initial', 'change', 'heartbeat']) {
      const message = once(viewer, 'message'); upstream.send(JSON.stringify(frame(reason, ++sequence)));
      const [raw] = await message;
      const dto = JSON.parse(raw.toString());
      assert.equal(dto.type, 'snapshot'); assert.equal(dto.reason, reason); assert.equal(dto.sequence, sequence); assert.equal(dto.snapshot.identityCoverage, 'complete');
      assert.equal(dto.snapshot.agents[0].status, 'working');
      assert.equal(dto.snapshot.agents[0].character, 'chatgpt');
      assert.equal(dto.snapshot.agents[0].validForMs, 44900);
      assert.doesNotMatch(raw.toString(), /synthetic-token|private_field|must-not-leak/);
    }
    const upstreamClosed = once(upstream, 'close');
    viewer.close(); await upstreamClosed;
  } finally { await f.close(); }
});

test('WS proxy rejects foreign origins and query parameters before opening upstream', async () => {
  const f = await fixture();
  try {
    for (const [path, origin] of [['/api/office/presence/ws', 'https://foreign.fixture'], ['/api/office/presence/ws?token=forbidden', 'https://office.fixture']]) {
      const viewer = f.connect(path, origin);
      const [error] = await once(viewer, 'error');
      assert.match(error.message, /403/);
    }
    assert.equal(f.configReads(), 0);
  } finally { await f.close(); }
});

test('malformed or binary upstream frames close downstream without exposing payloads', async () => {
  for (const payload of [JSON.stringify({ type: 'snapshot', secret: 'no-leak' }), Buffer.from('binary')]) {
    const f = await fixture();
    try {
      const connected = once(f.upstreamWss, 'connection');
      const viewer = f.connect(); await once(viewer, 'open');
      const [upstream] = await connected as [WebSocket];
      const closed = once(viewer, 'close'); upstream.send(payload);
      const [code, reason] = await closed;
      assert.equal(code, 1011); assert.doesNotMatch(reason.toString(), /secret|no-leak|binary/);
    } finally { await f.close(); }
  }
});

test('multiple viewers share one upstream, cached joins preserve age, removals fully replace state', async () => {
  const f = await fixture();
  try {
    const connected = once(f.upstreamWss, 'connection');
    const first = f.connect(); await once(first, 'open');
    const [upstream] = await connected as [WebSocket];
    let message = once(first, 'message'); upstream.send(JSON.stringify(frame())); await message;
    f.advance(1200);
    const second = f.connect();
    const cached = once(second, 'message'); await once(second, 'open');
    const [raw] = await cached;
    const dto = JSON.parse(raw.toString());
    assert.equal(dto.reason, 'initial'); assert.equal(dto.sequence, 1);
    assert.equal(dto.snapshot.agents[0].validForMs, 43700);
    assert.equal(f.configReads(), 1); assert.equal(f.upstreamWss.clients.size, 1);
    const removed = { ...frame('change', 2), instances: [], total: 0 };
    const both = [once(first, 'message'), once(second, 'message')]; upstream.send(JSON.stringify(removed));
    for (const [raw] of await Promise.all(both)) assert.deepEqual(JSON.parse(raw.toString()).snapshot.agents, []);
    const firstClosed = once(first, 'close'); first.close(); await firstClosed;
    assert.equal(upstream.readyState, WebSocket.OPEN, 'one departing viewer cannot close the shared upstream');
    const upstreamClosed = once(upstream, 'close'); second.close(); await upstreamClosed;
  } finally { await f.close(); }
});

test('sequence gaps, repeated initial, process replacement and non-initial first frames invalidate stream', async () => {
  for (const invalid of [frame('heartbeat', 3), frame('initial', 2), { ...frame('change', 2), processId: 'other-process' }, frame('heartbeat', 1)]) {
    const f = await fixture();
    try {
      const connected = once(f.upstreamWss, 'connection'); const viewer = f.connect(); await once(viewer, 'open');
      const [upstream] = await connected as [WebSocket];
      if (invalid.sequence !== 1) {
        const message = once(viewer, 'message'); upstream.send(JSON.stringify(frame())); await message;
      }
      const closed = once(viewer, 'close'); upstream.send(JSON.stringify(invalid));
      const [code] = await closed; assert.equal(code, 1011);
    } finally { await f.close(); }
  }
});

test('upstream authorization failures stop browser retries, rate limits use a distinct retryable close', async () => {
  for (const status of [401, 403, 429]) {
    const f = await fixture(status);
    try {
      const viewer = f.connect(); const closed = once(viewer, 'close'); await once(viewer, 'open');
      const [code] = await closed; assert.equal(code, status === 429 ? 1013 : 4403);
    } finally { await f.close(); }
  }
});

test('browser WS is read-only', async () => {
  const f = await fixture();
  try {
    const viewer = f.connect(); await once(viewer, 'open');
    const closed = once(viewer, 'close'); viewer.send('not allowed');
    const [code] = await closed; assert.equal(code, 1008);
  } finally { await f.close(); }
});
