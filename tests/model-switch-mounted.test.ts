import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeTopology } from '../src/core.ts';

test('mounted model switch cross-fades the displayed persona and respects reduced motion', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const original = Object.fromEntries(['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class LoadedImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_: string) { queueMicrotask(() => this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, handle = 0, reduced = false;
  const frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(), media = new Set<() => void>();
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ get matches() { return reduced; }, addEventListener: (_: string, listener: () => void) => media.add(listener), removeEventListener: (_: string, listener: () => void) => media.delete(listener) }) });
  dom.window.requestAnimationFrame = callback => { frames.set(++handle, callback); return handle; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  dom.window.setInterval = ((callback: () => void) => { timers.set(++handle, callback); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const root = createRoot(dom.window.document.getElementById('root')!);
  const container = dom.window.document.getElementById('root')!;
  const listeners = new Set<(state: AdapterState) => void>();
  const topology: OfficeTopology = { selfAgentId: 'self', childAgentIds: [], team: { layout: 'independent-desks', memberIds: [] } };
  const agent = (patch: Partial<OfficeAgent> = {}): OfficeAgent => ({
    id: 'self', name: 'DeckZ PI', character: 'chatgpt', status: 'working', latestUserRequest: null,
    source: 'synthetic-model-switch', observedAt: '2026-11-03T00:00:00Z', sourceFreshness: 'fresh', validForMs: 90_000,
    identity: { sourceId: 'test', instanceId: 'self', collectorEpoch: 'e1' }, provider: 'openai-codex', model: 'gpt-6', ...patch,
  });
  let snapshot = { receivedAt: '2026-11-03T00:00:00Z', identityCoverage: 'complete' as const, agents: [agent()] };
  const factory = (): OfficeAdapter => ({
    subscribe(listener) { listeners.add(listener); listener({ phase: 'connected', error: null, snapshot }); return () => { listeners.delete(listener); }; },
    connect() {}, dispose() {},
  });
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  const emit = async (next: OfficeAgent) => {
    snapshot = { ...snapshot, agents: [next] };
    await act(async () => listeners.forEach(listener => listener({ phase: 'connected', error: null, snapshot })));
    await flush();
  };
  const actor = () => container.querySelector('[data-office-actor="self"]');
  const swap = () => actor()?.querySelector('[data-office-model-switch="true"]') ?? null;
  try {
    const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
    await act(async () => root.render(createElement(LiveOffice, { adapterFactory: factory, topology, modeLabel: 'Model switch test', wallClock: () => new Date(2026, 0, 1, 12) })));
    await flush();
    assert.equal(actor()?.getAttribute('data-office-persona'), 'chatgpt');
    assert.equal(swap(), null);

    await emit(agent({ character: 'deepseek', provider: 'deepseek', model: 'deepseek-flash' }));
    assert.equal(actor()?.getAttribute('data-office-persona'), 'deepseek');
    assert.equal(swap()?.getAttribute('data-office-model-from'), 'chatgpt');
    assert.equal(swap()?.getAttribute('data-office-model-to'), 'deepseek');
    assert.match(actor()?.querySelector('[data-office-sprite="current"]')?.getAttribute('style') ?? '', /deepseek\/seated/);
    assert.match(actor()?.querySelector('[data-office-sprite="previous"]')?.getAttribute('style') ?? '', /chatgpt\/seated/);

    now += 2_000;
    await act(async () => timers.forEach(callback => callback()));
    assert.equal(swap(), null);

    reduced = true;
    await act(async () => media.forEach(listener => listener()));
    await emit(agent({ character: 'chatgpt', provider: 'openai-codex', model: 'gpt-6.1' }));
    assert.equal(actor()?.getAttribute('data-office-persona'), 'chatgpt');
    assert.equal(swap(), null);

    reduced = false;
    await act(async () => media.forEach(listener => listener()));
    await emit(agent({ character: 'chatgpt', provider: 'openai-codex', model: 'gpt-6.1-mini' }));
    assert.equal(swap()?.getAttribute('data-office-model-from'), 'chatgpt');
    assert.equal(swap()?.getAttribute('data-office-model-to'), 'chatgpt');
    assert.equal(actor()?.querySelector('[data-office-sprite="previous"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close(); await vite.close();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
