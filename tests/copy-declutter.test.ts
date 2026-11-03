import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

test('decluttered views retain mode labels, accessible controls and missing-data provenance', async () => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  try {
    const render = async (name: string) => {
      const module = await vite.ssrLoadModule(`/src/${name}.tsx`);
      return new JSDOM(renderToStaticMarkup(createElement(module[name]))).window.document;
    };
    for (const name of ['WholeOfficeDemo', 'LifecycleDemo', 'LiveOfficeExample', 'App']) {
      const doc = await render(name);
      assert.match(doc.body.textContent!, /模拟|合成/);
      assert.doesNotMatch(doc.body.textContent!, /同一间办公室，一起|看她，真的|人物更醒目|桌面收紧|先搭骨架|React \+ TypeScript|素材就绪前，不用/);
      assert.ok(doc.querySelector('h1'), `${name}: semantic page title retained`);
      for (const button of doc.querySelectorAll('button')) {
        assert.ok((button.getAttribute('aria-label') || button.textContent)?.trim(), `${name}: accessible button name`);
      }
      for (const section of doc.querySelectorAll('[aria-labelledby]')) {
        assert.ok(doc.getElementById(section.getAttribute('aria-labelledby')!), `${name}: label target exists`);
      }
      if (name === 'WholeOfficeDemo' || name === 'LifecycleDemo') {
        assert.equal(doc.querySelectorAll('[aria-current="step"]').length, 1);
        assert.ok(doc.querySelector('[role="progressbar"]'));
        assert.match(doc.querySelector('[role="status"]')!.textContent!, /载入|素材/);
        assert.equal(doc.querySelectorAll('.wo-footnote,.lc-footnote').length, 0);
      }
      if (name === 'LiveOfficeExample' || name === 'App') {
        assert.match(doc.body.textContent!, /数据来源/);
        assert.match(doc.body.textContent!, /状态新鲜度/);
        assert.match(doc.body.textContent!, /未提供用户请求/);
        assert.match(doc.body.textContent!, /请求时间/);
        assert.match(doc.body.textContent!, /摘要来源/);
      }
      if (name === 'LiveOfficeExample') assert.match(doc.body.textContent!, /合成测试 · 未连接实际主机/);
    }
    const shell = await render('DemoShell');
    assert.deepEqual([...shell.querySelectorAll('.view-switcher button')].map(button => button.textContent), ['办公室', '状态测试', '角色动作', '数据详情']);
  } finally { await vite.close(); }
});
