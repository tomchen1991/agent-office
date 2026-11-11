import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeAgent } from '../src/core.ts';

test('mounted seated breaks: own assets, idle delay, pause, all interruptions, stale data, model changes and optional failures', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const original = Object.fromEntries(['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const images: (() => void)[] = [];
  let failBreak = false, holdBreak = false;
  const delayedBreakImages: (() => void)[] = [];
  class LoadedImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { (holdBreak && value.endsWith('/seated-break.png') ? delayedBreakImages : images).push(() => failBreak && value.endsWith('/seated-break.png') ? this.onerror?.() : this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, handle = 0, hour = 12, reduced = false;
  const frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(), media = new Set<() => void>();
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => media.add(fn), removeEventListener: (_: string, fn: () => void) => media.delete(fn) }) });
  dom.window.requestAnimationFrame = fn => { frames.set(++handle, fn); return handle; }; dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  dom.window.setInterval = ((fn: () => void) => { timers.set(++handle, fn); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
  const root = createRoot(dom.window.document.getElementById('root')!), container = dom.window.document.getElementById('root')!;
  const listeners = new Set<(state: AdapterState) => void>();
  let status: OfficeAgent['status'] = 'idle', freshness: OfficeAgent['sourceFreshness'] = 'fresh', phase: AdapterState['phase'] = 'connected';
  let persona: OfficeAgent['character'] = 'deepseek';
  const state = (): AdapterState => ({ phase, error: null, snapshot: { receivedAt: new Date().toISOString(), agents: [{ id: 'child', name: 'child', character: persona, status, sourceFreshness: freshness, validForMs: 600000, source: 'synthetic-test', observedAt: new Date().toISOString(), latestUserRequest: null }] } });
  const factory = (): OfficeAdapter => ({ subscribe(fn) { listeners.add(fn); fn(state()); return () => { listeners.delete(fn); }; }, connect() {}, dispose() {} });
  const emit = async () => act(async () => { listeners.forEach(fn => fn(state())); });
  const step = async (count = 1) => { for (let i = 0; i < count; i++) { now += 100; const callbacks = [...frames.values()]; frames.clear(); await act(async () => { callbacks.forEach(fn => fn(now)); timers.forEach(fn => fn()); }); } };
  const actor = (id = 'child') => container.querySelector(`[data-office-actor="${id}"]`)!;
  const phaseOf = (id = 'child') => actor(id)?.getAttribute('data-office-phase');
  const click = async (label: string) => { const button = [...container.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label); assert.ok(button, label); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
  const renderLive = async (key = 'live') => { await act(async () => root.render(createElement(StrictMode, null, createElement(LiveOffice, { key, adapterFactory: factory, topology: { selfAgentId: 'self', childAgentIds: ['child'], team: { layout: 'independent-desks', memberIds: [] } }, wallClock: () => new Date(2026, 10, 3, hour) })))); for (let i = 0; i < 40 && images.length; i++) await act(async () => images.splice(0).forEach(fn => fn())); };
  const sheet = () => actor()?.querySelector('[data-office-sheet]')?.getAttribute('data-office-sheet');
  try {
    await renderLive(); await step(49); assert.equal(phaseOf(), 'seated');
    await step(3); assert.equal(phaseOf(), 'seated-break'); assert.equal(sheet(), 'seatedBreak');
    assert.match(actor().innerHTML, /deepseek\/seated-break/);
    assert.equal(actor().getAttribute('data-office-status'), 'idle');
    const placement = actor().getAttribute('style');
    await step(40); assert.equal(actor().getAttribute('style'), placement, 'props remain at the desk');
    await click('暂停状态动画'); const frozen = actor().innerHTML; await step(20); assert.equal(actor().innerHTML, frozen);
    status = 'working'; await emit(); assert.equal(phaseOf(), 'seated'); assert.equal(sheet(), 'seated');
    await click('继续状态动画');
    for (const interruption of ['waiting', 'stopping', 'unknown'] as const) {
      status = 'idle'; await emit(); await step(52); assert.equal(phaseOf(), 'seated-break');
      status = interruption; await emit(); assert.equal(phaseOf(), 'seated'); assert.equal(sheet(), 'seated');
    }
    status = 'idle'; await emit(); await step(52); assert.equal(phaseOf(), 'seated-break');
    freshness = 'stale'; await emit(); assert.equal(phaseOf(), 'seated'); assert.equal(actor().getAttribute('data-office-status'), 'unknown');
    freshness = 'fresh'; await emit(); await step(52); assert.equal(phaseOf(), 'seated-break');
    phase = 'disconnected'; await emit(); assert.equal(phaseOf(), 'seated');
    phase = 'connected'; await emit(); await step(52); assert.equal(phaseOf(), 'seated-break');
    for (const next of ['grok','chatgpt'] as const) {
      persona = next; await emit(); for (let i = 0; i < 40 && images.length; i++) await act(async () => images.splice(0).forEach(fn => fn())); assert.equal(phaseOf(), 'seated'); assert.equal(sheet(), 'seated');
      await step(49); assert.equal(phaseOf(), 'seated'); await step(3); assert.equal(phaseOf(), 'seated-break');
      assert.match(actor().innerHTML, new RegExp(`${next}/seated-break`));
    }
    await act(async () => { reduced = true; media.forEach(fn => fn()); }); assert.equal(phaseOf(), 'seated'); assert.equal(sheet(), 'seated'); assert.equal(frames.size, 0);
    reduced = false; failBreak = true; await renderLive('missing-break'); await step(160);
    assert.equal(phaseOf(), 'seated'); assert.equal(sheet(), 'seated');
    assert.equal(container.querySelector('[data-office-assets-ready]')?.getAttribute('data-office-assets-ready'), 'true');
    failBreak = false;
    const flushImages = async () => { for (let i = 0; i < 40 && images.length; i++) await act(async () => images.splice(0).forEach(fn => fn())); };
    const { WholeOfficeDemo } = await vite.ssrLoadModule('/src/WholeOfficeDemo.tsx');
    await act(async () => root.render(createElement(WholeOfficeDemo))); await flushImages();
    await click('跳转到摸鱼中');
    for (const role of ['deepseek','grok','chatgpt']) {
      const sprites = [...container.querySelectorAll(`[data-office-persona="${role}"] [data-office-sheet]`)];
      assert.ok(sprites.length > 0, role); assert.ok(sprites.every(sprite => sprite.getAttribute('data-office-sheet') === 'seatedBreak'));
    }
    await click('跳转到工作中'); assert.equal(container.querySelectorAll('[data-office-sheet="seatedBreak"]').length, 0);
    holdBreak = true;
    await act(async () => root.render(createElement(WholeOfficeDemo, {key:'late-break'}))); await flushImages();
    await click('跳转到摸鱼中'); assert.equal(container.querySelectorAll('[data-office-sheet="seatedBreak"]').length, 0);
    assert.ok(delayedBreakImages.length >= 3);
    await act(async () => delayedBreakImages.splice(0).forEach(fn => fn()));
    assert.equal(container.querySelectorAll('[data-office-sheet="seatedBreak"]').length, 0, 'late optional success must not change a paused slack pose');
    await click('播放办公室演示'); await step(10);
    assert.equal(container.querySelectorAll('[data-office-sheet="seatedBreak"]').length, 0, 'resuming the same slack session must retain fallback');
    await click('跳转到工作中'); await click('跳转到摸鱼中');
    assert.ok(container.querySelectorAll('[data-office-sheet="seatedBreak"]').length >= 3, 'next slack entry admits the now-loaded art');
    holdBreak = false;
    const { LifecycleDemo } = await vite.ssrLoadModule('/src/LifecycleDemo.tsx');
    await act(async () => root.render(createElement(LifecycleDemo))); await flushImages();
    for (const role of ['deepseek','grok','chatgpt']) {
      await act(async () => container.querySelector(`.character-${role}`)!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles:true}))); await flushImages();
      const slack = [...container.querySelectorAll('.lc-stage-nav button')].find(button => button.textContent?.includes('摸鱼中'))!;
      await act(async () => slack.dispatchEvent(new dom.window.MouseEvent('click', {bubbles:true})));
      assert.equal(container.querySelector('[data-demo-sheet]')?.getAttribute('data-demo-sheet'), 'seatedBreak');
      assert.match(container.querySelector('[data-demo-sheet]')!.getAttribute('style')!, new RegExp(`${role}/seated-break`));
      const paused = container.querySelector('[data-demo-frame]')?.getAttribute('data-demo-frame'); await step(10);
      assert.equal(container.querySelector('[data-demo-frame]')?.getAttribute('data-demo-frame'), paused);
    }
    await act(async () => root.unmount()); assert.equal(frames.size, 0); assert.equal(timers.size, 0);
  } finally {
    await act(async () => { try { root.unmount(); } catch {} }); dom.window.close(); await vite.close();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
