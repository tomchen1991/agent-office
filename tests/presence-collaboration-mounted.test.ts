import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeAgent } from '../src/core.ts';
import { createPresenceSeatAllocator, presenceTopology } from '../src/presence.ts';

test('live presence renders separate collaboration table labels and marks stale observations', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const keys = ['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class LoadedImage { onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  const root = createRoot(dom.window.document.getElementById('root')!);
  const container = dom.window.document.getElementById('root')!;
  const agent = (id: string, group: string): OfficeAgent => ({ id, name: id, character: 'chatgpt', status: 'idle', sourceFreshness: 'fresh', validForMs: 90000, source: 'pi', observedAt: null, latestUserRequest: null, collaboration: { group } });
  const agents = [agent('a', '工时平台开发'), agent('b', '工时平台开发'), agent('c', '财务平台开发'), agent('d', '财务平台开发')];
  let state: AdapterState = { phase: 'connected', error: null, snapshot: { agents, receivedAt: '', identityCoverage: 'complete' } };
  const listeners = new Set<(state: AdapterState) => void>();
  const adapter: OfficeAdapter = { connect() {}, dispose() {}, subscribe(fn) { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; } };
  const factory = () => adapter;
  try {
    const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
    const topology = createPresenceSeatAllocator()(presenceTopology(agents), agents);
    await act(async () => root.render(createElement(LiveOffice, { adapterFactory: factory, topology })));
    const labels = () => [...container.querySelectorAll('.wo-live-collaboration-label')].map(node => node.textContent);
    assert.deepEqual(labels(), ['工时平台开发 · 2 位协作 PI', '财务平台开发 · 2 位协作 PI']);
    state = { ...state, snapshot: { ...state.snapshot!, agents: agents.map(agent => ({ ...agent, sourceFreshness: 'stale' })) } };
    await act(async () => listeners.forEach(fn => fn(state)));
    assert.equal(labels().length, 2);
    assert.ok(labels().every(label => label?.includes('最后观察')));
    state = { ...state, snapshot: { ...state.snapshot!, agents: [] } };
    await act(async () => listeners.forEach(fn => fn(state)));
    assert.equal(container.querySelector('.wo-live-collaboration-label'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close(); await vite.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
