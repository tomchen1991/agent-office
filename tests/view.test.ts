import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoTopology } from '../src/mock.ts';

test('office SSR renders accessible topology, bounded seats and truthful missing data', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  try {
    const { App } = await vite.ssrLoadModule('/src/App.tsx');
    const html = renderToStaticMarkup(createElement(App));
    assert.throws(() => renderToStaticMarkup(createElement(App, { topology: {...demoTopology, childAgentIds: ['self']} })), /unique/);
    assert.match(html, /独立办公室/);
    assert.match(html, /另有 1 个子 Agent 未展示/);
    assert.match(html, /团队负责人/);
    assert.match(html, /未提供用户请求/);
    assert.match(html, /占位形象/);
    const peer = renderToStaticMarkup(createElement(App, { topology: { ...demoTopology, team: {...demoTopology.team, layout: 'peer-table'} } }));
    assert.match(peer, /共享协作桌/);
    assert.doesNotMatch(peer, /class="leader-seat"/);
  } finally { await vite.close(); }
});
