import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeTopology } from '../src/core.ts';

// Vite only transforms TSX here. These are mounted DOM lifecycle tests, not browser/visual QA.
test('mounted office interactions and hook cleanup', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const original = Object.fromEntries(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true})) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = dom.window.document.getElementById('root')!;
  const frames = new Map<number, FrameRequestCallback>();
  let nextHandle = 0, now = 0, reduced = false;
  const mediaListeners = new Set<() => void>();
  Object.defineProperty(dom.window, 'matchMedia', {value: () => ({get matches() { return reduced; }, addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener), removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener)})});
  dom.window.requestAnimationFrame = callback => { const handle = ++nextHandle; frames.set(handle, callback); return handle; };
  dom.window.cancelAnimationFrame = handle => { frames.delete(handle); };
  const root = createRoot(container);
  const buttons = () => [...container.querySelectorAll('button')];
  const button = (text: string) => { const found = buttons().find(item => item.textContent === text); assert.ok(found, `missing button ${text}`); return found; };
  const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const step = async (count = 8) => { for (let i = 0; i < count; i++) { now += 100; const callbacks = [...frames.values()]; frames.clear(); await act(async () => { callbacks.forEach(callback => callback(now)); }); } };
  try {
    const { App } = await vite.ssrLoadModule('/src/App.tsx');
    await act(async () => root.render(createElement(StrictMode, null, createElement(App))));
    await step();
    await t.test('mount settles, bounded child seats and detail selection work repeatedly', async () => {
      assert.equal(container.querySelectorAll('.child-seats .agent-seat').length, 3);
      assert.equal(container.querySelector('.overflow')?.textContent, '+1');
      assert.match(container.querySelector('.request-body')?.textContent ?? '', /模拟请求/);
      const grok = container.querySelector('button[aria-label^="Grok，"]')!;
      await click(grok); await click(grok);
      assert.equal(container.querySelector('#details-title')?.textContent, 'Grok');
      assert.match(container.querySelector('.request-body')?.textContent ?? '', /未提供用户请求/);
      await click(container.querySelector('button[aria-label^="自研 Agent，"]')!);
      assert.match(container.querySelector('.request-body')?.textContent ?? '', /模拟请求/);
    });
    await t.test('pause freezes transition and resumes without duplicate actors', async () => {
      await click(button('暂停全部动画'));
      assert.match(container.querySelector<HTMLImageElement>('.owner-desk img')!.src, /standing-v2\.png$/);
      await click(button('离场演示'));
      const leaving = container.querySelector('.phase-leaving')!;
      assert.ok(leaving);
      const style = leaving.getAttribute('style');
      await step();
      assert.equal(container.querySelector('.phase-leaving')?.getAttribute('style'), style);
      assert.equal(frames.size, 0);
      await click(button('播放全部动画'));
      await step();
      assert.equal(container.querySelectorAll('.phase-leaving').length, 0);
      await click(button('重新入场'));
      await step();
      assert.equal(container.querySelectorAll('.owner-desk .motion-avatar').length, 1);
    });
    await t.test('rapid leave/return and topology switches end at newest target', async () => {
      for (let i = 0; i < 3; i++) { await click(button('离场演示')); await click(button('重新入场')); }
      const radios = [...container.querySelectorAll<HTMLInputElement>('input[name="layout"]')];
      for (let i = 0; i < 3; i++) { await click(radios[1]); await click(radios[0]); }
      await step();
      assert.equal(container.querySelectorAll('.phase-leaving').length, 0);
      assert.equal(container.querySelectorAll('.phase-moving').length, 0);
      assert.equal(container.querySelectorAll('.owner-desk .motion-avatar').length, 1);
      assert.equal(container.querySelectorAll('.leader-seat').length, 1);
      await click(radios[1]); await step();
      assert.equal(container.querySelectorAll('.leader-seat').length, 0);
      assert.equal(container.querySelectorAll('.shared-table').length, 1);
    });
    await t.test('disconnect downgrades work status; reconnect and reduced-motion work', async () => {
      await click(button('工作中'));
      assert.equal(container.querySelector('.owner-desk .agent-status')?.textContent, '工作中');
      await click(button('断开数据源'));
      assert.equal(container.querySelector('.owner-desk .agent-status')?.textContent, '状态未知');
      assert.equal(frames.size, 0);
      await click(button('连接数据源')); await step();
      assert.equal(container.querySelector('.owner-desk .agent-status')?.textContent, '工作中');
      await act(async () => { reduced = true; mediaListeners.forEach(listener => listener()); });
      assert.equal(button('系统偏好：减少动态').disabled, true);
      await click(button('离场演示'));
      assert.equal(container.querySelectorAll('.phase-leaving').length, 0);
      await click(button('重新入场'));
      assert.equal(container.querySelectorAll('.owner-desk .phase-seated').length, 1);
      assert.equal(frames.size, 0);
      await act(async () => { reduced = false; mediaListeners.forEach(listener => listener()); });
      assert.equal(button('暂停全部动画').disabled, false);
    });
    await t.test('source switch, multiple epoch replacements and unmount cancel subscriptions/clocks', async () => {
      const topology = (id: string): OfficeTopology => ({selfAgentId: id, childAgentIds: [], team: {layout: 'peer-table', memberIds: []}});
      const listeners = new Set<(state: AdapterState) => void>();
      let disposalCount = 0;
      let currentId = 'epoch-1';
      const snapshot = (): AdapterState => ({phase: 'connected', error: null, snapshot: {receivedAt: new Date().toISOString(), agents: [{id: currentId, name: currentId, character: 'self', status: 'working', observedAt: null, sourceFreshness: 'fresh', validForMs: 90_000, source: 'test', latestUserRequest: null}]}});
      const factory = (): OfficeAdapter => ({subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); }; }, connect() {}, dispose() { disposalCount++; }});
      await act(async () => root.render(createElement(StrictMode, null, createElement(App, {adapterFactory: factory, topology: topology(currentId), modeLabel: '测试来源'}))));
      assert.equal(listeners.size, 1);
      for (const id of ['epoch-2', 'epoch-3', 'epoch-4']) {
        currentId = id;
        await act(async () => { listeners.forEach(listener => listener(snapshot())); root.render(createElement(StrictMode, null, createElement(App, {adapterFactory: factory, topology: topology(id), modeLabel: '测试来源'}))); });
      }
      await step();
      assert.equal(container.querySelectorAll('.phase-leaving').length, 0);
      assert.equal(container.querySelectorAll('.motion-avatar').length, 1);
      assert.equal(container.querySelector('#details-title')?.textContent, 'epoch-4');
      const secondListeners = new Set<(state: AdapterState) => void>();
      const secondFactory = (): OfficeAdapter => ({subscribe(listener) { secondListeners.add(listener); listener({...snapshot(), phase: 'disconnected', snapshot: null}); return () => {secondListeners.delete(listener);}; }, connect() {}, dispose() {disposalCount++;}});
      await act(async () => root.render(createElement(StrictMode, null, createElement(App, {adapterFactory: secondFactory, topology: topology('new-source'), modeLabel: '第二来源'}))));
      assert.equal(listeners.size, 0);
      assert.equal(secondListeners.size, 1);
      assert.equal(container.querySelectorAll('.motion-avatar').length, 0);
      assert.doesNotMatch(container.querySelector('.office-scene')?.textContent ?? '', /epoch-4/);
      await act(async () => root.unmount());
      assert.equal(secondListeners.size, 0);
      assert.equal(listeners.size, 0);
      assert.ok(disposalCount > 0);
      assert.equal(frames.size, 0);
      assert.equal(mediaListeners.size, 0);
    });
  } finally {
    await act(async () => { try { root.unmount(); } catch {} });
    dom.window.close(); await vite.close();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
