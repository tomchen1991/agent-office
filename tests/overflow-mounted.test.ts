import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { demoCharacters } from '../src/demoAssets.ts';

test('overflow sprites preserve feet, support deferred tablet art, pause and detail selection', async () => {
  const vite = await createServer({ configFile: false, server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const original = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const frames = new Map<number, FrameRequestCallback>(); let handle = 0;
  dom.window.requestAnimationFrame = fn => { frames.set(++handle, fn); return handle; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    const { OverflowAgents } = await vite.ssrLoadModule('/src/OverflowAgents.tsx');
    const character = { ...demoCharacters[1], tablet: { ...demoCharacters[1].locomotion, src: 'synthetic-tablet.png' } };
    let loaded = false, selected = '';
    const sourceKey = {};
    const render = async (status: string, paused = false, reducedMotion = false) => act(async () => root.render(createElement(OverflowAgents, {
      targets: [{ id: 'overflow', identityKey: 'epoch', name: 'Overflow', persona: 'deepseek', status }],
      characters: [character], sourceKey, paused, reducedMotion, assetReady: (src: string) => src !== 'synthetic-tablet.png' || loaded, onSelect: (id: string) => { selected = id; },
    })));
    const actor = () => dom.window.document.querySelector<HTMLElement>('[data-overflow-agent]')!;
    await render('idle');
    const start = actor().style.left;
    for (const time of [0, 100, 200]) await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); });
    assert.notEqual(actor().style.left, start);
    const position = actor().style.left;
    await render('working');
    assert.equal(actor().style.left, position);
    assert.equal(actor().dataset.overflowArt, 'standing');
    loaded = true;
    await render('working');
    assert.equal(actor().dataset.overflowArt, 'tablet');
    await act(async () => actor().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(selected, 'overflow');
    await render('working', true); assert.equal(frames.size, 0);
    await render('idle', false, true); assert.equal(frames.size, 0);
    await render('unknown'); assert.equal(frames.size, 0); assert.equal(actor().dataset.overflowArt, 'standing');
    await render('offline'); assert.equal(dom.window.document.querySelector('[data-overflow-agent]'), null);
  } finally {
    await act(async () => root.unmount()); dom.window.close(); await vite.close();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
