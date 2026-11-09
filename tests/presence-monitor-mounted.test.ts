import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeTopology } from '../src/core.ts';
import { presenceStatus } from '../server/presenceProxy.ts';

test('presence monitors clear retained exit metadata without erasing uncertain observations or inspector history', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const keys = ['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class LoadedImage { onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, handle = 0, reduced = false;
  const frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(), media = new Set<() => void>();
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => media.add(fn), removeEventListener: (_: string, fn: () => void) => media.delete(fn) }) });
  dom.window.requestAnimationFrame = fn => { frames.set(++handle, fn); return handle; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  dom.window.setInterval = ((fn: () => void) => { timers.set(++handle, fn); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const topology: OfficeTopology = { selfAgentId: 'agent', childAgentIds: [], team: { layout: 'independent-desks', memberIds: [] } };
  const agent = (patch: Partial<OfficeAgent> = {}): OfficeAgent => ({ id: 'agent', name: 'Synthetic agent', character: 'chatgpt', source: 'fixture', status: 'working', sourceFreshness: 'fresh', validForMs: 45000, observedAt: null, latestUserRequest: null, task: { name: 'Retained work', type: null, startedAt: null, detail: null }, repo: 'synthetic-repo', ...patch });
  let state: AdapterState = { phase: 'connected', error: null, snapshot: { agents: [agent()], receivedAt: '', identityCoverage: 'complete' } };
  const listeners = new Set<(state: AdapterState) => void>();
  const factory = (): OfficeAdapter => ({ connect() {}, dispose() {}, subscribe(fn) { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; } });
  const publish = async (agents: OfficeAgent[], phase: AdapterState['phase'] = 'connected') => {
    state = { phase, error: null, snapshot: { ...state.snapshot!, agents } };
    await act(async () => listeners.forEach(fn => fn(state)));
  };
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 100) {
      now += 100;
      await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); timers.forEach(fn => fn()); });
    }
  };
  const monitor = () => container.querySelector('.wo-monitor')!;
  const actor = () => container.querySelector('[data-office-actor="agent"]');
  const assertIdle = (symbol = '○') => {
    assert.equal(Boolean(monitor().querySelector('.wo-screen-content')), false);
    assert.equal(Boolean(monitor().querySelector('.wo-screen-task, .wo-screen-repository')), false);
    assert.equal(monitor().getAttribute('title'), null);
    assert.equal(monitor().classList.contains('wo-screen-work'), false);
    assert.equal(monitor().querySelector('.wo-screen strong')?.textContent, symbol);
  };
  try {
    const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
    await act(async () => root.render(createElement(LiveOffice, { adapterFactory: factory, topology, wallClock: () => new Date(2026, 0, 1, 12) })));
    await t.test('explicit stopping clears computer immediately, through departure and later retained heartbeats', async () => {
      assert.equal(actor()?.getAttribute('data-office-phase'), 'seated');
      assert.match(monitor().textContent ?? '', /Retained work/);
      await act(async () => actor()!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      await publish([agent({ status: presenceStatus('stopping') })]);
      assert.equal(actor()?.getAttribute('data-office-phase'), 'stand');
      assertIdle();
      assert.match(container.querySelector('.live-inspector')?.textContent ?? '', /Retained work/);
      await advance(6200);
      assert.equal(actor(), null);
      assertIdle();
      await publish([agent({ status: 'offline', sourceFreshness: 'stale' })]);
      assert.equal(actor(), null);
      assertIdle();
    });
    await t.test('new live observation restores the screen; idle and uncertain metadata remain distinguishable', async () => {
      await publish([agent({ task: { name: 'New work', type: null, startedAt: null, detail: null }, repo: 'new-repo' })]);
      assert.match(monitor().textContent ?? '', /New work/);
      assert.doesNotMatch(monitor().textContent ?? '', /Retained work/);
      await publish([agent({ status: 'idle', task: undefined, repo: null })]);
      assert.equal(monitor().querySelector('.wo-screen strong')?.textContent, '···');
      await publish([agent({ status: 'unknown', task: undefined, repo: null })]);
      assert.equal(monitor().querySelector('.wo-screen strong')?.textContent, '?');
      await publish([agent({ status: 'idle' })]);
      assert.match(monitor().textContent ?? '', /Retained work/);
      await publish([agent({ sourceFreshness: 'stale' })]);
      assert.match(monitor().textContent ?? '', /最后观察/);
      assert.match(monitor().textContent ?? '', /Retained work/);
      await publish([agent()], 'disconnected');
      assert.match(monitor().textContent ?? '', /最后观察/);
      assert.match(monitor().textContent ?? '', /Retained work/);
    });
    await t.test('reduced motion exit and missing rows also leave the monitor idle', async () => {
      reduced = true;
      await act(async () => media.forEach(fn => fn()));
      await publish([agent({ status: 'offline' })]);
      assert.equal(actor(), null);
      assertIdle();
      await publish([]);
      assertIdle('?');
    });
  } finally {
    await act(async () => root.unmount());
    assert.equal(frames.size, 0); assert.equal(timers.size, 0);
    dom.window.close(); await vite.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
