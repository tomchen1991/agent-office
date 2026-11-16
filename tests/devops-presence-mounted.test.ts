import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { normalizePresence } from '../src/presence.ts';
import { PRESENCE_MAPPING } from '../src/presenceConfig.ts';
import type { AdapterState, OfficeAdapter } from '../src/core.ts';

test('collector DevOps observations render existing dedicated art, task details and uncertain state', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const keys = ['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class LoadedImage { onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const normalize = (status = 'working', freshness = 'fresh') => normalizePresence({
    version: 1, persistence: 'memory', complete: true, processId: 'fixture-epoch', staleAfterMs: 45000,
    instances: [{ sourceId: 'devops-agent', instanceId: 'backend', status, freshness, ageMs: freshness === 'fresh' ? 100 : 46000,
      data: { instance_id: 'backend', member_name: 'DevOps Agent', provider: null, model: null, task_name: 'Inspect fixture release', status_detail: 'Synthetic observation', repo: 'fixture-repo' } }],
  }, { sourceKinds: PRESENCE_MAPPING.sourceKinds });
  const next = normalize();
  let state: AdapterState = { phase: 'connected', error: null, snapshot: next.snapshot };
  const listeners = new Set<(state: AdapterState) => void>();
  const adapterFactory = (): OfficeAdapter => ({ connect() {}, dispose() {}, subscribe(fn) { listeners.add(fn); fn(state); return () => { listeners.delete(fn); }; } });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const actor = () => container.querySelector('[data-office-persona="devops"]');
  const publish = async (status: string, freshness = 'fresh', phase: AdapterState['phase'] = 'connected') => {
    state = { phase, error: null, snapshot: normalize(status, freshness).snapshot };
    await act(async () => listeners.forEach(fn => fn(state)));
  };
  try {
    const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
    await act(async () => root.render(createElement(LiveOffice, { adapterFactory, topology: next.topology, wallClock: () => new Date(2026, 0, 1, 12) })));
    assert.equal(actor()?.getAttribute('data-office-seat-kind'), 'devops');
    assert.equal(actor()?.getAttribute('data-office-status'), 'working');
    assert.ok(actor()?.querySelector('.wo-sprite'));
    assert.equal(container.querySelectorAll('[data-office-actor]').length, 1);
    assert.equal(container.querySelector('[data-office-desk="devops-desk"]')?.getAttribute('data-office-empty'), 'false');
    assert.match(container.textContent ?? '', /Inspect fixture release/);
    await act(async () => actor()!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(container.querySelector('.live-inspector')?.textContent ?? '', /DevOps Agent/);
    assert.match(container.querySelector('.live-inspector')?.textContent ?? '', /fixture-repo/);
    for (const status of ['idle', 'waiting']) {
      await publish(status);
      assert.equal(actor()?.getAttribute('data-office-status'), status);
      assert.equal(actor()?.getAttribute('data-office-persona'), 'devops');
    }
    await publish('unknown', 'stale');
    assert.equal(actor()?.getAttribute('data-office-status'), 'unknown');
    assert.match(container.textContent ?? '', /最后观察/);
    await publish('working', 'fresh', 'disconnected');
    assert.equal(actor()?.getAttribute('data-office-status'), 'unknown');
    // Presence does not turn the decorative service-health screen into monitoring.
    assert.match(container.querySelector('.devops-monitor')?.textContent ?? container.textContent ?? '', /未连接/);
    await publish('stopping');
    assert.equal(actor(), null);
  } finally {
    await act(async () => root.unmount());
    assert.equal(listeners.size, 0);
    dom.window.close(); await vite.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
