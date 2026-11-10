import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

test('visual monitor stays unconnected, never requests data, and restores focus after repeated detail dismissal', async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const original = Object.fromEntries(['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT','fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let fetches = 0;
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: async () => { fetches++; throw new Error('Unexpected fetch'); } })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); };
  const container = dom.window.document.getElementById('root')!; const root = createRoot(container);
  try {
    const { DevopsMonitor } = await vite.ssrLoadModule('/src/DevopsMonitor.tsx');
    await act(async () => root.render(createElement(DevopsMonitor)));
    assert.match(container.textContent!, /未连接服务数据源/);
    assert.equal(container.querySelectorAll('.devops-services li').length, 0);
    assert.ok(container.querySelector('.devops-monitor--compact'));
    assert.equal(fetches, 0);
    const open = container.querySelector('button')!;
    for (let i = 0; i < 2; i++) {
      await act(async () => open.click());
      const dialog = dom.window.document.querySelector('dialog')!;
      assert.equal(dialog.getAttribute('aria-label'), 'DevOps 服务监控详情'); assert.equal(dialog.querySelectorAll('li').length, 0);
      assert.match(dialog.textContent!, /未连接服务数据源/);
      assert.equal(dialog.open, true);
      await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
      assert.equal(dom.window.document.querySelector('dialog'), null); assert.equal(dom.window.document.activeElement, open);
    }
    await act(async () => open.click()); await act(async () => dom.window.document.querySelector<HTMLButtonElement>('dialog button')!.click()); assert.equal(dom.window.document.querySelector('dialog'), null);
    await act(async () => root.render(createElement(DevopsMonitor, { compact: false })));
    assert.equal(container.querySelector('.devops-monitor--compact'), null);
    assert.match(container.textContent!, /未连接服务数据源/);
    assert.equal(fetches, 0);
  } finally {
    await act(async () => root.unmount()); dom.window.close(); await vite.close();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
