import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ResidentOfficeTopology as OfficeTopology } from '../src/residentLayout.ts';
import type { AdapterState, OfficeAdapter, OfficeAgent } from '../src/core.ts';

test('resident sprites follow explicit seats, animate live states and night rest without service requests', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const original = Object.fromEntries(['window', 'document', 'HTMLElement', 'Image', 'fetch', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const images: (() => void)[] = [];
  let requests = 0;
  // Synthetic image completion checks renderer wiring, not browser decoding or visual quality.
  class LoadedImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { images.push(() => this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true, fetch: async () => { requests++; throw new Error('No network in synthetic resident view'); } })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, handle = 0, hour = 12, reduced = false;
  const frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(), media = new Set<() => void>();
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => media.add(fn), removeEventListener: (_: string, fn: () => void) => media.delete(fn) }) });
  dom.window.requestAnimationFrame = fn => { frames.set(++handle, fn); return handle; }; dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  dom.window.setInterval = ((fn: () => void) => { timers.set(++handle, fn); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
  const container = dom.window.document.getElementById('root')!, root = createRoot(container);
  const listeners = new Set<(state: AdapterState) => void>();
  const topology: OfficeTopology = { selfAgentId: 'absent-owner', devopsAgentId: 'ops-instance', hotspotAgentId: 'news-instance', childAgentIds: [], team: { layout: 'independent-desks', memberIds: ['ordinary'] } };
  const agent = (id: string, character: OfficeAgent['character']): OfficeAgent => ({ id, name: id, character, status: 'working', sourceFreshness: 'fresh', validForMs: 600000, source: 'synthetic-test', observedAt: new Date().toISOString(), latestUserRequest: null });
  // Deliberately unrelated providers and no residentRole hint: topology owns the resident artwork.
  let agents = [agent('ops-instance', 'chatgpt'), agent('news-instance', 'deepseek'), agent('ordinary', 'grok')];
  const state = (): AdapterState => ({ phase: 'connected', error: null, snapshot: { agents, receivedAt: new Date().toISOString() } });
  const factory = (): OfficeAdapter => ({ subscribe(fn) { listeners.add(fn); fn(state()); return () => { listeners.delete(fn); }; }, connect() {}, dispose() {} });
  const emit = async (status: OfficeAgent['status'], freshness: OfficeAgent['sourceFreshness'] = 'fresh') => { agents = agents.map(a => ({ ...a, status, sourceFreshness: freshness })); await act(async () => listeners.forEach(fn => fn(state()))); };
  const step = async (count = 1) => { for (let i = 0; i < count; i++) { now += 100; const callbacks = [...frames.values()]; frames.clear(); await act(async () => { callbacks.forEach(fn => fn(now)); timers.forEach(fn => fn()); }); } };
  const actor = (id: string) => container.querySelector(`[data-office-actor="${id}"]`);
  const residents = ['ops-instance', 'news-instance'];
  const phase = (id: string) => actor(id)?.getAttribute('data-office-phase');
  const sprite = (id: string) => actor(id)?.querySelector('[data-office-frame]');
  const click = async (label: string) => { const button = [...container.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label); assert.ok(button, label); await act(async () => button.click()); };
  try {
    const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
    await act(async () => root.render(createElement(StrictMode, null, createElement(LiveOffice, { adapterFactory: factory, topology, wallClock: () => new Date(2026, 10, 10, hour) }))));
    for (let i = 0; i < 60 && images.length; i++) await act(async () => images.splice(0).forEach(fn => fn()));
    assert.equal(actor('ops-instance')?.getAttribute('data-office-persona'), 'devops');
    assert.equal(actor('news-instance')?.getAttribute('data-office-persona'), 'hotspot');
    assert.equal(actor('ordinary')?.getAttribute('data-office-persona'), 'grok');
    assert.equal(actor('absent-owner'), null);
    assert.equal(container.querySelector('[data-office-desk="github-desk"]')?.getAttribute('data-office-empty'), 'true');
    assert.equal(container.querySelectorAll('[data-office-actor]').length, 3);
    for (const id of residents) { assert.equal(phase(id), 'seated'); assert.match(sprite(id)?.getAttribute('style') ?? '', new RegExp(id === 'ops-instance' ? 'devops' : 'hotspot')); }
    const observedFrames = residents.map(() => new Set<string | null | undefined>());
    for (let tick = 0; tick < 12; tick++) { await step(); residents.forEach((id, index) => observedFrames[index].add(sprite(id)?.getAttribute('data-office-frame'))); }
    for (const seen of observedFrames) assert.deepEqual([...seen].sort(), ['0', '1']);
    for (const status of ['idle', 'waiting', 'working'] as const) { await emit(status); for (const id of residents) { assert.equal(phase(id), 'seated'); assert.ok((status === 'working' ? ['0', '1'] : ['6', '7']).includes(sprite(id)?.getAttribute('data-office-frame') ?? '')); } }
    await emit('offline'); await step(70); for (const id of residents) assert.equal(actor(id), null);
    await emit('working'); for (const id of residents) assert.equal(phase(id), 'arrival');
    await step(12); await click('暂停状态动画'); const frozen = residents.map(id => actor(id)?.outerHTML); await step(10); assert.deepEqual(residents.map(id => actor(id)?.outerHTML), frozen);
    await click('继续状态动画'); await step(60); for (const id of residents) assert.equal(phase(id), 'seated');
    hour = 23; await emit('idle'); await step(51); for (const id of residents) assert.equal(phase(id), 'drowse');
    await step(10); for (const id of residents) { assert.equal(phase(id), 'sleep'); assert.equal(sprite(id)?.getAttribute('data-office-sheet'), 'sleep'); }
    await click('暂停状态动画'); await emit('working'); for (const id of residents) assert.equal(phase(id), 'wake'); await step(10); for (const id of residents) assert.equal(phase(id), 'wake');
    await click('继续状态动画'); await step(8); for (const id of residents) assert.equal(phase(id), 'seated');
    await emit('idle'); await step(65); await emit('idle', 'stale'); for (const id of residents) { assert.equal(phase(id), 'seated'); assert.equal(actor(id)?.getAttribute('data-office-status'), 'unknown'); }
    await emit('idle'); await step(65); await act(async () => { reduced = true; media.forEach(fn => fn()); }); for (const id of residents) assert.equal(phase(id), 'seated');
    // Without explicit resident bindings, their furniture is retained but no resident is fabricated.
    const unconfigured = { selfAgentId: 'absent-owner', childAgentIds: [], team: { layout: 'independent-desks', memberIds: ['ordinary'] } };
    await act(async () => root.render(createElement(LiveOffice, { key: 'unconfigured', adapterFactory: factory, topology: unconfigured })));
    for (let i = 0; i < 60 && images.length; i++) await act(async () => images.splice(0).forEach(fn => fn()));
    for (const id of residents) assert.equal(actor(id), null);
    for (const desk of ['devops-desk', 'hotspot-desk']) assert.equal(container.querySelector(`[data-office-desk="${desk}"]`)?.getAttribute('data-office-empty'), 'true');
    assert.equal(requests, 0);
    await act(async () => root.unmount()); assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(listeners.size, 0); assert.equal(media.size, 0);
  } finally {
    await act(async () => { try { root.unmount(); } catch {} }); dom.window.close(); await vite.close();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
