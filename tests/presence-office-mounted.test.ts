import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { collectorFrame } from './fixtures/presence.ts';

test('presence WS retains observations, detects silence and safely resumes browser lifecycle', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'https://office.example/' });
  const keys = ['window', 'document', 'HTMLElement', 'Image', 'WebSocket', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class LoadedImage { onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()); } }
  class Socket {
    static all: Socket[] = [];
    onmessage?: (event: { data: string }) => void;
    onclose?: (event?: { code?: number }) => void;
    onerror?: () => void;
    closed = false;
    sequence = 0;
    url: URL;
    constructor(url: URL) { this.url = url; Socket.all.push(this); }
    close() { this.closed = true; this.onclose?.(); }
    message(body: unknown) { this.onmessage?.({ data: JSON.stringify(body) }); }
  }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, WebSocket: Socket, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, hidden = false, handle = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const intervals = new Map<number, () => void>();
  Object.defineProperty(dom.window.document, 'hidden', { get: () => hidden });
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  dom.window.setTimeout = ((callback: () => void, delay: number) => { timers.set(++handle, { callback, delay }); return handle; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = id => { if (id !== undefined) timers.delete(id); };
  dom.window.setInterval = ((callback: () => void) => { intervals.set(++handle, callback); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) intervals.delete(id); };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const frame = collectorFrame();
  const latest = () => Socket.all.at(-1)!;
  const respond = async (socket = latest(), body: object = {}) => {
    const reason = socket.sequence === 0 ? 'initial' : 'heartbeat';
    const sequence = ++socket.sequence;
    await act(async () => socket.message(structuredClone({ ...frame, reason, sequence, ...body })));
  };
  const runTimer = async (delay: number) => {
    const matches = [...timers].filter(([, timer]) => timer.delay === delay);
    assert.equal(matches.length, 1, `exactly one ${delay}ms timer`);
    const [id, timer] = matches[0]; timers.delete(id);
    await act(async () => timer.callback());
  };
  const visibility = async (value: boolean) => { await act(async () => { hidden = value; dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); }); };
  const event = async (name: string) => { await act(async () => dom.window.dispatchEvent(new dom.window.Event(name))); };
  const actor = () => container.querySelector('[data-office-actor]');
  const alert = () => container.querySelector('[role="alert"]')?.textContent ?? '';
  try {
    const { PresenceOffice } = await vite.ssrLoadModule('/src/PresenceOffice.tsx');
    await act(async () => root.render(createElement(StrictMode, null, createElement(PresenceOffice))));
    await t.test('Strict Mode closes old socket and ignores late frames; no polling timer', async () => {
      assert.equal(Socket.all.length, 2);
      assert.equal(Socket.all[0].closed, true);
      assert.equal(latest().url.href, 'wss://office.falsita.cn/api/presence/v1/ws');
      await respond(Socket.all[0], { instances: [], total: 0 });
      assert.equal(actor(), null);
      await respond();
      assert.equal(actor()?.getAttribute('data-office-status'), 'working');
      assert.deepEqual([...timers.values()].map(t => t.delay), [35000]);
    });
    await t.test('network failures retain snapshot details without renewing freshness; reconnect backs off', async () => {
      await act(async () => actor()!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      now = 600;
      await act(async () => latest().onerror?.());
      assert.match(alert(), /自动重连/);
      assert.equal(actor()?.getAttribute('data-office-status'), 'unknown');
      assert.match(container.querySelector('.wo-world')?.textContent ?? '', /Retained task/);
      assert.match(container.querySelector('.wo-world')?.textContent ?? '', /retained-repo/);
      assert.equal(container.querySelector('[data-live-freshness]')?.textContent, '新鲜');
      now = 1100;
      await act(async () => intervals.forEach(fn => fn()));
      assert.equal(container.querySelector('[data-live-freshness]')?.textContent, '已过期');
      await runTimer(1000);
      await act(async () => latest().onclose?.());
      await runTimer(2000);
      await respond();
      assert.equal(alert(), '');
      assert.equal(actor()?.getAttribute('data-office-status'), 'working');
    });
    await t.test('full heartbeats confirm state; silence and malformed frames reconnect', async () => {
      await respond(latest(), { reason: 'heartbeat' });
      await runTimer(35000);
      assert.equal(latest().closed, true);
      await runTimer(1000);
      await respond(latest(), { type: 'invalid' });
      assert.match(alert(), /自动重连/);
      await runTimer(2000);
      await respond();
      await respond(latest(), { reason: 'change', sequence: 999 });
      assert.match(alert(), /自动重连/);
      await runTimer(1000);
      await respond();
    });
    await t.test('hide closes stream, resume deduplicates and stale callbacks cannot replace topology', async () => {
      const old = latest(), count = Socket.all.length;
      await visibility(true);
      assert.equal(old.closed, true);
      assert.equal(timers.size, 0);
      await event('pageshow'); await event('online');
      assert.equal(Socket.all.length, count);
      await visibility(false);
      assert.equal(Socket.all.length, count + 1);
      await event('pageshow'); await event('online'); await visibility(false);
      assert.equal(Socket.all.length, count + 1);
      await respond(old, { reason: 'change', instances: [], total: 0 });
      assert.ok(actor());
      assert.equal(timers.size, 1);
      await respond();
      await event('offline');
      assert.equal(latest().closed, true);
      assert.match(alert(), /网络已断开/);
      await event('online'); await respond();
    });
    await t.test('unmount removes timers/listeners and initially hidden mounts do not connect', async () => {
      const pending = latest();
      await act(async () => root.render(null));
      assert.equal(pending.closed, true);
      assert.equal(timers.size, 0); assert.equal(intervals.size, 0);
      const count = Socket.all.length;
      await event('online'); await event('pageshow'); await respond(pending);
      assert.equal(Socket.all.length, count);
      hidden = true;
      await act(async () => root.render(createElement(PresenceOffice)));
      assert.equal(Socket.all.length, count);
      await visibility(false);
      assert.equal(Socket.all.length, count + 1);
      await respond();
    });
    await t.test('authorization failure stops automatic retries even on online/pageshow', async () => {
      const count = Socket.all.length;
      await act(async () => latest().onclose?.({ code: 4403 }));
      assert.match(alert(), /授权失败/);
      assert.equal(timers.size, 0);
      await event('online'); await event('pageshow');
      assert.equal(Socket.all.length, count);
    });
  } finally {
    await act(async () => root.unmount()); dom.window.close(); await vite.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
