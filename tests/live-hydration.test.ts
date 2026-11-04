import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

test('first observed occupants appear seated; subsequent newcomers still arrive', async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const original = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    const { useLiveOfficeMotion } = await vite.ssrLoadModule('/src/useLiveOfficeMotion.ts');
    const sourceKey = {};
    function Harness({ ids }: { ids: string[] }) {
      const actors = useLiveOfficeMotion(ids.map(id => ({ id, identityKey: id, seatKey: id, status: 'working' })), { sourceKey, paused: true, reducedMotion: false, assetsReady: true, hydrateSeated: true });
      return createElement('output', null, JSON.stringify(actors.map((a: any) => [a.id, a.phase])));
    }
    await act(async () => root.render(createElement(Harness, { ids: [] })));
    await act(async () => root.render(createElement(Harness, { ids: ['existing'] })));
    assert.equal(dom.window.document.querySelector('output')!.textContent, '[["existing","seated"]]');
    await act(async () => root.render(createElement(Harness, { ids: ['existing', 'new'] })));
    assert.equal(dom.window.document.querySelector('output')!.textContent, '[["existing","seated"],["new","arrival"]]');
  } finally {
    await act(async () => root.unmount());
    await vite.close(); dom.window.close();
    keys.forEach((key, index) => { const descriptor = original[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
});
