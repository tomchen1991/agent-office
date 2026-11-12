import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { connectPresenceStream } from '../src/presenceStream.ts';
import { presenceWebSocketURL } from '../src/presenceConfig.ts';
import type { AdapterState, OfficeTopology } from '../src/core.ts';
import { collectorFrame } from './fixtures/presence.ts';

function browser() {
  const dom = new JSDOM('', { url: 'https://office.example/', pretendToBeVisual: true });
  const keys = ['window', 'document', 'WebSocket'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class Socket {
    static all: Socket[] = [];
    onmessage?: (event: { data: unknown }) => void;
    onclose?: (event: { code: number }) => void;
    onerror?: () => void;
    closed = false;
    readonly url: URL;
    constructor(url: URL, ...extra: unknown[]) { this.url = url; assert.deepEqual(extra, []); Socket.all.push(this); }
    close() { this.closed = true; }
    message(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, WebSocket: Socket })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let id = 0;
  dom.window.setTimeout = ((callback: () => void, delay: number) => { timers.set(++id, { callback, delay }); return id; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = key => { if (key !== undefined) timers.delete(key); };
  return {
    Socket, timers,
    close() {
      dom.window.close();
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

function observer() {
  let state: AdapterState = { phase: 'connecting', snapshot: null, error: null };
  let topology: OfficeTopology | undefined;
  return {
    publish(next: AdapterState | ((previous: AdapterState) => AdapterState)) { state = typeof next === 'function' ? next(state) : next; },
    setTopology(next: OfficeTopology) { topology = next; },
    state: () => state, topology: () => topology,
  };
}

test('each page directly connects to the collector and computes independently; no shared upstream or credentials', () => {
  const b = browser();
  const a = observer(), c = observer();
  const closeA = connectPresenceStream(a.publish, a.setTopology);
  const closeC = connectPresenceStream(c.publish, c.setTopology);
  try {
    assert.equal(b.Socket.all.length, 2);
    const [socketA, socketC] = b.Socket.all;
    assert.equal(socketA.url.href, 'wss://collect.falsita.cn/api/presence/v1/ws');
    socketA.message(collectorFrame());
    socketC.message({ ...collectorFrame(), instances: [], total: 0 });
    assert.equal(a.state().snapshot?.agents.length, 1);
    assert.equal(c.state().snapshot?.agents.length, 0);
    assert.equal(a.state().snapshot?.agents[0].character, 'deepseek');
    assert.ok(!JSON.stringify(a.state()).includes('private_field'));
    closeA();
    assert.equal(socketA.closed, true);
    assert.equal(socketC.closed, false);
    socketA.message({ ...collectorFrame('change', 2), instances: [], total: 0 });
    assert.equal(a.state().snapshot?.agents.length, 1);
  } finally { closeA(); closeC(); b.close(); }
});

test('direct stream rejects incomplete/malformed snapshots, epoch changes, gaps and oversized frames', () => {
  const b = browser();
  try {
    for (const malformed of [
      null, { ...collectorFrame('initial', 2) }, { ...collectorFrame('heartbeat', 2), processId: 'different' },
      { ...collectorFrame('heartbeat', 3) }, { ...collectorFrame('heartbeat', 2), complete: false },
      { ...collectorFrame('heartbeat', 2), total: 2 }, { ...collectorFrame('heartbeat', 2), heartbeatIntervalMs: 1 },
      { ...collectorFrame('heartbeat', 2), instances: [] }, { ...collectorFrame('heartbeat', 2), startedAt: 'invalid' },
      { ...collectorFrame('heartbeat', 2), instances: [collectorFrame().instances[0], collectorFrame().instances[0]], total: 2 },
    ]) {
      const o = observer(), dispose = connectPresenceStream(o.publish, o.setTopology);
      const socket = b.Socket.all.at(-1)!;
      socket.message(collectorFrame());
      socket.message(malformed);
      assert.equal(o.state().phase, 'disconnected');
      assert.equal(socket.closed, true);
      assert.equal(o.state().snapshot?.agents.length, 1);
      dispose();
    }
    for (const raw of ['x'.repeat(1048577), new ArrayBuffer(8), '{', '"' + '汉'.repeat(400000) + '"']) {
      const o = observer(), dispose = connectPresenceStream(o.publish, o.setTopology);
      const socket = b.Socket.all.at(-1)!;
      socket.message(collectorFrame()); socket.onmessage?.({ data: raw });
      assert.equal(o.state().phase, 'disconnected');
      dispose();
    }
    assert.equal(b.timers.size, 0);
  } finally { b.close(); }
});

test('reconnect accepts a new collector epoch and keeps surviving local seats; explicit public mapping is applied', () => {
  const b = browser(), o = observer();
  const dispose = connectPresenceStream(o.publish, o.setTopology, { mapping: { sourceLabels: { test: 'Public label' } } });
  try {
    const first = b.Socket.all[0]; first.message(collectorFrame());
    const seats = o.topology()!.team.seatAssignments;
    assert.equal(o.state().snapshot?.agents[0].sourceLabel, 'Public label');
    first.onerror?.();
    const [id, timer] = [...b.timers].find(([, timer]) => timer.delay === 1000)!;
    b.timers.delete(id); timer.callback();
    const second = b.Socket.all.at(-1)!;
    second.message({ ...collectorFrame(), processId: 'restarted' });
    assert.equal(o.state().phase, 'connected');
    assert.deepEqual(o.topology()!.team.seatAssignments, seats);
    assert.equal(o.state().snapshot?.agents[0].identity?.collectorEpoch, 'restarted');
    second.message({ ...collectorFrame('change', 2), processId: 'restarted', instances: [], total: 0 });
    assert.deepEqual(o.topology()!.team.seatAssignments, {});
    assert.deepEqual(o.state().snapshot?.agents, []);
  } finally { dispose(); b.close(); }
});

test('collector URL accepts TLS or loopback only and rejects URL credentials', () => {
  assert.equal(presenceWebSocketURL('wss://collect.example/api/presence/v1/ws').hostname, 'collect.example');
  assert.equal(presenceWebSocketURL('ws://127.0.0.1:9000/ws').protocol, 'ws:');
  for (const url of ['https://collect.example/ws', '/api/office/presence/ws', 'ws://collect.example/ws',
    'wss://user:secret@collect.example/ws', 'wss://collect.example/ws?token=secret', 'wss://collect.example/ws#secret']) {
    assert.throws(() => presenceWebSocketURL(url));
  }
  const b = browser(), o = observer();
  try {
    const dispose = connectPresenceStream(o.publish, o.setTopology, { url: 'wss://collect.example/ws?token=secret' });
    assert.equal(b.Socket.all.length, 0);
    assert.equal(o.state().phase, 'disconnected');
    assert.equal(b.timers.size, 0);
    assert.ok(!o.state().error?.includes('secret'));
    dispose();
  } finally { b.close(); }
});
