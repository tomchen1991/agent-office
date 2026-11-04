import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeAgent } from '../src/core.ts';

test('mounted night rest: two dedicated roles, live uncertainty, paused wake, time jumps, reduced motion, optional failures and main demo', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const original = Object.fromEntries(['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const images: (() => void)[] = [];
  let failSleep = false;
  class LoadedImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { images.push(() => failSleep && value.endsWith('/sleep.png') ? this.onerror?.() : this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, handle = 0, hour = 23, reduced = false;
  const frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(), media = new Set<() => void>();
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => media.add(fn), removeEventListener: (_: string, fn: () => void) => media.delete(fn) }) });
  dom.window.requestAnimationFrame = fn => { frames.set(++handle, fn); return handle; }; dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  dom.window.setInterval = ((fn: () => void) => { timers.set(++handle, fn); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
  const root = createRoot(dom.window.document.getElementById('root')!), container = dom.window.document.getElementById('root')!;
  const listeners = new Set<(state: AdapterState) => void>();
  let status: OfficeAgent['status'] = 'idle', freshness: OfficeAgent['sourceFreshness'] = 'fresh', phase: AdapterState['phase'] = 'connected';
  const state = (): AdapterState => ({ phase, error: null, snapshot: { receivedAt: new Date().toISOString(), agents: ['self','github','child'].map(id => ({ id, name: id, character: id === 'github' ? 'github' : 'self', status, sourceFreshness: freshness, validForMs: 600000, source: 'synthetic-test', observedAt: new Date().toISOString(), latestUserRequest: null })) } });
  const factory = (): OfficeAdapter => ({ subscribe(fn) { listeners.add(fn); fn(state()); return () => { listeners.delete(fn); }; }, connect() {}, dispose() {} });
  const emit = async () => act(async () => { listeners.forEach(fn => fn(state())); });
  const step = async (count = 1) => { for (let i = 0; i < count; i++) { now += 100; const callbacks = [...frames.values()]; frames.clear(); await act(async () => { callbacks.forEach(fn => fn(now)); timers.forEach(fn => fn()); }); } };
  const actor = (id = 'self') => container.querySelector(`[data-office-actor="${id}"]`)!;
  const phaseOf = (id = 'self') => actor(id)?.getAttribute('data-office-phase');
  const click = async (label: string) => { const button = [...container.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label); assert.ok(button, label); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const select = async (label: string, value: string) => { const input = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; assert.ok(input); await act(async () => { input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
  const renderLive = async (key = 'live') => { await act(async () => root.render(createElement(StrictMode, null, createElement(LiveOffice, { key, adapterFactory: factory, topology: { selfAgentId: 'self', githubAgentId: 'github', childAgentIds: ['child'], team: { layout: 'independent-desks', memberIds: [] } }, wallClock: () => new Date(2026, 10, 3, hour), wallClockLabel: '模拟测试时钟' })))); for (let i = 0; i < 40 && images.length; i++) await act(async () => images.splice(0).forEach(fn => fn())); };
  try {
    await renderLive(); await step(130);
    assert.equal(phaseOf(), 'sleep'); assert.equal(phaseOf('github'), 'sleep'); assert.notEqual(phaseOf('child'), 'sleep');
    assert.equal(container.querySelectorAll('[data-scythe-owner]').length, 1);
    await click('暂停状态动画'); const frozen = actor().innerHTML; await step(20); assert.equal(actor().innerHTML, frozen);
    status = 'working'; await emit(); assert.equal(phaseOf(), 'wake'); assert.equal(container.querySelectorAll('.wo-screen-work').length, 1, 'only child can work before dedicated wake finishes');
    await step(10); assert.equal(phaseOf(), 'wake'); await click('继续状态动画'); await step(8); assert.equal(phaseOf(), 'seated'); assert.equal(container.querySelectorAll('.wo-screen-work').length, 3);
    status = 'idle'; await emit(); await step(65); assert.equal(phaseOf(), 'sleep');
    freshness = 'stale'; await emit(); assert.equal(phaseOf(), 'seated'); assert.equal(actor().querySelector('[data-office-sheet]')?.getAttribute('data-office-sheet'), 'seated'); assert.doesNotMatch(actor().getAttribute('aria-label')!, /休息/);
    freshness = 'fresh'; await emit(); await step(65); assert.equal(phaseOf(), 'sleep');
    phase = 'disconnected'; await emit(); assert.equal(phaseOf(), 'seated'); assert.equal(actor().getAttribute('data-office-status'), 'unknown');
    phase = 'connected'; await emit(); await step(65); assert.equal(phaseOf(), 'sleep');
    hour = 12; await step(); assert.equal(phaseOf(), 'wake'); await step(8); assert.equal(phaseOf(), 'seated');
    hour = 23; await step(65); assert.equal(phaseOf(), 'sleep');
    await act(async () => { reduced = true; media.forEach(fn => fn()); }); assert.equal(phaseOf(), 'seated'); assert.equal(frames.size, 0);
    reduced = false; failSleep = true; await renderLive('missing-sleep'); await step(160); assert.equal(phaseOf(), 'seated'); assert.equal(actor().getAttribute('data-office-personal-phase'), null); assert.equal(container.querySelector('[data-office-assets-ready]')?.getAttribute('data-office-assets-ready'), 'true');
    failSleep = false;
    const { WholeOfficeDemo } = await vite.ssrLoadModule('/src/WholeOfficeDemo.tsx');
    await act(async () => root.render(createElement(WholeOfficeDemo))); await act(async () => images.splice(0).forEach(fn => fn()));
    await select('办公室模拟时段', 'night'); await click('跳转到摸鱼中'); await click('播放办公室演示'); await step(65);
    assert.equal(phaseOf(), 'sleep'); assert.equal(phaseOf('github-demo'), 'sleep');
    await click('暂停办公室演示'); await select('办公室模拟时段', 'day'); assert.equal(phaseOf(), 'wake'); await step(8); assert.equal(phaseOf(), 'wake'); await click('播放办公室演示'); await step(8); assert.notEqual(phaseOf(), 'sleep');
    await click('跳转到摸鱼中'); await click('播放办公室演示'); await step(51);
    assert.equal(actor().getAttribute('data-office-personal-phase'), 'scythe');
    await select('办公室模拟时段', 'night'); assert.equal(actor().getAttribute('data-office-personal-phase'), 'scythe'); assert.equal(container.querySelectorAll('[data-scythe-owner]').length, 1);
    await step(60); await click('跳转到摸鱼中'); await click('播放办公室演示'); await step(65); assert.equal(phaseOf(), 'sleep');
    await click('跳转到工作中'); assert.notEqual(phaseOf(), 'sleep'); assert.notEqual(phaseOf(), 'wake');
    await click('重播办公室演示'); assert.equal(phaseOf(), 'arrival');
    await act(async () => root.unmount()); assert.equal(frames.size, 0); assert.equal(timers.size, 0);
  } finally {
    await act(async () => { try { root.unmount(); } catch {} }); dom.window.close(); await vite.close();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
