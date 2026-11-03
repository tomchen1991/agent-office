import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeSnapshot, OfficeTopology } from '../src/core.ts';
import type { OfficeConfig } from '../src/config.ts';

test('mounted live office follows normalized DTOs in the shared room and cancels every interrupted lifecycle', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const original = Object.fromEntries(['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const pending: (() => void)[] = [];
  class LoadedImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { pending.push(() => value.includes('missing-extra') ? this.onerror?.() : this.onload?.()); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: LoadedImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, handle = 0, reduced = false, disposed = 0;
  const frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(), media = new Set<() => void>();
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ get matches() { return reduced; }, addEventListener: (_: string, listener: () => void) => media.add(listener), removeEventListener: (_: string, listener: () => void) => media.delete(listener) }) });
  dom.window.requestAnimationFrame = callback => { frames.set(++handle, callback); return handle; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  dom.window.setInterval = ((callback: () => void) => { timers.set(++handle, callback); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const container = dom.window.document.getElementById('root')!;
  const listeners = new Set<(state: AdapterState) => void>();
  const agent = (id: string, status: OfficeAgent['status'] = 'working', patch: Partial<OfficeAgent> = {}): OfficeAgent => ({ id, name: id, status, character: id === 'self' ? 'self' : id === 'mystery' ? 'unknown' : 'deepseek', latestUserRequest: null, source: 'contract-test', observedAt: '2026-11-03T00:00:00Z', sourceFreshness: 'fresh', validForMs: 90_000, identity: { sourceId: 'test', instanceId: id, collectorEpoch: 'e1' }, ...patch });
  const topology: OfficeTopology = { selfAgentId: 'self', childAgentIds: ['child-1', 'child-2', 'child-3', 'child-4', 'child-5'], team: { layout: 'independent-desks', memberIds: ['a', 'b', 'mystery'] } };
  let snapshot: OfficeSnapshot = { receivedAt: '2026-11-03T00:00:00Z', identityCoverage: 'complete', agents: [agent('self', 'working', { latestUserRequest: { summary: 'Only actual USER summary', receivedAt: '2026-11-02T23:59:00Z', source: 'user-event-test' } }), ...topology.childAgentIds.map(id => agent(id, 'idle')), agent('a', 'idle'), agent('b', 'waiting'), agent('mystery')] };
  const factory = (): OfficeAdapter => ({ subscribe(listener) { listeners.add(listener); listener({ phase: 'connected', error: null, snapshot }); return () => { listeners.delete(listener); }; }, connect() {}, dispose() { disposed++; } });
  const emit = async (agents: readonly OfficeAgent[], extra: Partial<OfficeSnapshot> = {}, phase: AdapterState['phase'] = 'connected') => { snapshot = { ...snapshot, ...extra, agents }; await act(async () => listeners.forEach(listener => listener({ phase, error: null, snapshot }))); };
  const self = () => container.querySelector('[data-office-actor="self"]');
  const sprite = () => self()?.querySelector('[data-office-frame]');
  const click = async (label: string) => { const button = [...container.querySelectorAll('button')].find(item => item.textContent === label); assert.ok(button, label); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const step = async (count = 1) => { for (let index = 0; index < count; index++) { now += 100; const callbacks = [...frames.values()]; frames.clear(); await act(async () => { callbacks.forEach(callback => callback(now)); timers.forEach(callback => callback()); }); } };
  const render = async (props: Record<string, unknown> = {}) => { const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx'); await act(async () => root.render(createElement(StrictMode, null, createElement(LiveOffice, { adapterFactory: factory, topology, modeLabel: 'Synthetic contract test', ...props })))); await act(async () => pending.splice(0).forEach(callback => callback())); };
  try {
    await render();
    await t.test('same spatial office, correct identities and latest request without fabricated summaries', async () => {
      assert.equal(listeners.size, 1); assert.equal(container.querySelectorAll('[data-office-desk][data-office-seat-kind="team"]').length, 10);
      assert.equal(container.querySelectorAll('[data-office-actor][data-office-seat-kind="simulated-child"]').length, 2);
      assert.match(container.querySelector('.wo-child-overflow')?.textContent ?? '', /\+3/);
      assert.equal(container.querySelector('[data-office-seat="self-child-3"]'), null);
      assert.equal(container.querySelectorAll('[data-office-desk][data-office-seat-kind="simulated-child"]').length, 2);
      await click('child-3');
      assert.equal(container.querySelector('#live-details-title')?.textContent, 'child-3');
      assert.equal(container.querySelector('[data-office-actor="child-3"]'), null);
      await click('self');
      assert.ok(container.querySelector('.wo-private-door')); assert.ok(container.querySelector('.wo-parked-scythe'));
      assert.ok(container.querySelector('[data-office-actor="mystery"] .wo-unknown-persona'));
      assert.doesNotMatch(container.querySelector('.wo-world')!.textContent!, /[\p{L}]/u);
      assert.equal(container.querySelector('.wo-world')!.getAttribute('role'), 'group');
      for (const button of container.querySelectorAll('.wo-seat-select')) {
        assert.match(button.getAttribute('aria-label')!, /查看详情/);
        assert.equal(button.textContent, '●');
      }
      assert.match(self()!.getAttribute('aria-label')!, /self/);
      assert.equal(container.querySelector('[data-office-actor="mystery"] .wo-sprite'), null);
      assert.match(container.querySelector('.live-request')?.textContent ?? '', /Only actual USER summary/);
      await step(12);
      const arrivalStyle = self()?.getAttribute('style'), arrivalFrame = sprite()?.getAttribute('data-office-frame');
      await click('暂停状态动画'); await step(8);
      assert.equal(self()?.getAttribute('style'), arrivalStyle); assert.equal(sprite()?.getAttribute('data-office-frame'), arrivalFrame);
      assert.equal(frames.size, 0);
      await click('继续状态动画'); await step(34);
      assert.equal(self()?.getAttribute('data-office-phase'), 'sit');
      const sitStyle = self()?.getAttribute('style'), sitFrame = sprite()?.getAttribute('data-office-frame');
      await click('暂停状态动画'); await step(8);
      assert.equal(self()?.getAttribute('style'), sitStyle); assert.equal(sprite()?.getAttribute('data-office-frame'), sitFrame);
      await click('继续状态动画'); await step(22);
      assert.equal(self()?.getAttribute('data-office-phase'), 'seated');
      assert.ok(['0', '1'].includes(sprite()?.getAttribute('data-office-frame') ?? ''));
    });
    await t.test('idle and waiting use 6/7, stopping is neutral, rapid states do not restart arrival', async () => {
      for (const status of ['idle', 'working', 'waiting', 'stopping', 'working', 'idle'] as const) {
        await emit(snapshot.agents.map(item => item.id === 'self' ? { ...item, status, latestUserRequest: null } : item));
        assert.equal(self()?.getAttribute('data-office-phase'), 'seated');
        assert.equal(container.querySelectorAll('[data-office-actor="self"]').length, 1);
        assert.ok((status === 'working' ? ['0', '1'] : ['6', '7']).includes(sprite()?.getAttribute('data-office-frame') ?? ''));
        assert.equal(container.querySelectorAll('.wo-screen-error,.wo-error-bubble').length, 0);
      }
      assert.match(container.querySelector('.live-request')?.textContent ?? '', /未提供用户请求摘要/);
      assert.doesNotMatch(container.querySelector('.live-request')?.textContent ?? '', /Only actual USER summary/);
    });
    await t.test('both personal idle actors animate only fresh idle, cancel during pause, and return before work', async () => {
      await emit([agent('self', 'idle'), agent('repair', 'idle', { character: 'github' })]);
      await render({ topology: { ...topology, githubAgentId: 'repair' } });
      await step(62); // GitHub arrival; owner has already started its idle cycle.
      await emit([agent('self', 'working'), agent('repair', 'working', { character: 'github' })]);
      await step(35);
      await emit([agent('self', 'idle'), agent('repair', 'idle', { character: 'github' })]);
      await step(51);
      assert.equal(self()?.getAttribute('data-office-phase'), 'personal');
      assert.equal(container.querySelector('[data-office-actor="repair"] .wo-sprite')?.getAttribute('data-office-sheet'), 'extra');
      await step(44);
      assert.equal(sprite()?.getAttribute('data-office-sheet'), 'extra');
      assert.ok(!sprite()?.getAttribute('style')?.includes('NaN'));
      const before = self()?.getAttribute('style');
      await click('暂停状态动画'); await step(10); assert.equal(self()?.getAttribute('style'), before);
      await emit([agent('self', 'idle', { sourceFreshness: 'stale' }), agent('repair', 'idle', { character: 'github', sourceFreshness: 'stale' })]);
      assert.equal(self()?.getAttribute('data-office-status'), 'unknown');
      assert.equal(sprite()?.getAttribute('data-office-sheet'), 'extra');
      assert.equal(self()?.getAttribute('style'), before);
      await click('继续状态动画');
      await emit([agent('self', 'idle'), agent('repair', 'idle', { character: 'github' })]); await step(30);
      await emit([agent('self', 'working'), agent('repair', 'working', { character: 'github' })]);
      assert.equal(self()?.getAttribute('data-office-phase'), 'personal');
      assert.ok(['pickup', 'locomotion'].includes(sprite()?.getAttribute('data-office-sheet') ?? ''));
      assert.notEqual(sprite()?.getAttribute('data-office-sheet'), 'seated');
      await step(45); assert.equal(self()?.getAttribute('data-office-phase'), 'seated');
      await emit([agent('self', 'idle')]); await step(75);
      const frozenStyle = self()?.getAttribute('style');
      await act(async () => { reduced = true; media.forEach(listener => listener()); });
      assert.equal(self()?.getAttribute('data-office-phase'), 'personal'); assert.equal(self()?.getAttribute('style'), frozenStyle);
      await act(async () => { reduced = false; media.forEach(listener => listener()); });
      await emit([agent('self')]); await step(45); await render();
    });
    await t.test('optional extra failure keeps base office visible and idle neutral, later successful asset enables actions', async () => {
      const { demoCharacters } = await vite.ssrLoadModule('/src/demoAssets.ts');
      const broken = demoCharacters.map((item: { extra?: { src: string } }) => ({ ...item, ...(item.extra ? { extra: { ...item.extra, src: 'missing-extra.png' } } : {}) }));
      await emit([agent('self', 'idle')]); await render({ characters: broken });
      assert.equal(container.querySelector('[data-office-assets-ready]')?.getAttribute('data-office-assets-ready'), 'true');
      await step(140); assert.equal(self()?.getAttribute('data-office-phase'), 'seated');
      assert.equal(sprite()?.getAttribute('data-office-sheet'), 'seated');
      await render(); await step(52); assert.equal(self()?.getAttribute('data-office-phase'), 'personal');
      await emit([agent('self', 'working')]);
      // Atlas restoration can meet a spinning owner: finish its current turn
      // and exact-grip settle before testing unrelated seated lifecycle states.
      for (let i = 0; i < 60 && self()?.getAttribute('data-office-phase') !== 'seated'; i++) await step();
      assert.equal(self()?.getAttribute('data-office-phase'), 'seated');
    });
    await t.test('partial absence preserves uncertain seat without departure or old request; stale/disconnect stop work', async () => {
      await emit(snapshot.agents.filter(item => item.id !== 'self'), { identityCoverage: 'partial' });
      assert.equal(self()?.getAttribute('data-office-phase'), 'seated'); assert.equal(self()?.getAttribute('data-office-status'), 'unknown');
      assert.equal(sprite()?.getAttribute('data-office-frame'), '6');
      await emit([agent('self'), ...snapshot.agents], { identityCoverage: 'complete' });
      await click('暂停状态动画'); assert.equal(frames.size, 0);
      now += 91_000; await act(async () => timers.forEach(callback => callback()));
      assert.equal(self()?.getAttribute('data-office-status'), 'unknown'); assert.equal(sprite()?.getAttribute('data-office-frame'), '6');
      assert.match(container.querySelector('[data-live-freshness]')?.textContent ?? '', /已过期/);
      // A phase-only repeat of the identical snapshot must not refresh its lifetime.
      await act(async () => listeners.forEach(listener => listener({ phase: 'connected', error: null, snapshot })));
      assert.equal(self()?.getAttribute('data-office-status'), 'unknown');
      await click('继续状态动画'); assert.equal(frames.size, 0);
      await emit(snapshot.agents); assert.equal(self()?.getAttribute('data-office-status'), 'working');
      await emit(snapshot.agents, {}, 'disconnected'); assert.equal(frames.size, 0); assert.equal(sprite()?.getAttribute('data-office-frame'), '6');
      await emit(snapshot.agents); assert.equal(self()?.getAttribute('data-office-status'), 'working');
    });
    await t.test('offline alone uses neutral stand/exit, return and epoch changes cannot leave ghosts', async () => {
      await emit(snapshot.agents.map(item => item.id === 'self' ? { ...item, status: 'offline' } : item));
      assert.equal(self()?.getAttribute('data-office-phase'), 'stand'); assert.equal(sprite()?.getAttribute('data-office-frame'), '6');
      await step(62); assert.equal(self(), null); assert.match(container.querySelector('[data-live-current-status]')?.textContent ?? '', /离线/);
      await emit(snapshot.agents.map(item => item.id === 'self' ? { ...item, status: 'working' } : item));
      assert.equal(self()?.getAttribute('data-office-phase'), 'arrival');
      await emit(snapshot.agents.map(item => item.id === 'self' ? { ...item, identity: { sourceId: 'test', instanceId: 'self', collectorEpoch: 'e2' } } : item));
      assert.equal(container.querySelectorAll('[data-office-actor="self"]').length, 1);
      await step(62); assert.equal(self()?.getAttribute('data-office-phase'), 'seated');
      await render({ topology: { ...topology, team: { ...topology.team, layout: 'peer-table' } } });
      assert.equal(container.querySelectorAll('[data-office-shared-table]').length, 2);
      assert.equal(container.querySelectorAll('[data-office-desk][data-office-seat-kind="team"]').length, 10);
      assert.equal(container.querySelector('[data-office-actor="mystery"]')?.getAttribute('data-office-facing'), 'left');
      await act(async () => { reduced = true; media.forEach(listener => listener()); }); assert.equal(frames.size, 0);
    });
    await t.test('GitHub dedicated actor retains presentation and inspector selection for topology and config', async () => {
      const github = agent('repair', 'waiting', { name: 'GitHub fixture', character: 'github' });
      await emit([agent('self'), github], { identityCoverage: 'complete' });
      await render({ topology: { ...topology, githubAgentId: 'repair' } });
      const actor = () => container.querySelector('[data-office-actor="repair"]');
      assert.equal(actor()?.getAttribute('data-office-persona'), 'github');
      assert.equal(actor()?.getAttribute('data-office-seat-kind'), 'github');
      const select = container.querySelector('button[aria-label^="GitHub fixture，"]')!;
      await act(async () => select.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      assert.match(container.querySelector('.live-inspector')?.textContent ?? '', /GitHub fixture/);
      const config: OfficeConfig = { version: 1, seats: ['self','repair'].map(id => ({ id, name: id === 'repair' ? 'Configured GitHub' : 'Owner', character: id === 'repair' ? 'github' : 'self', selector: { sourceId: 'test', instanceId: id, epoch: { policy: 'follow-unique' } } })), office: { selfSeatId: 'self', githubSeatId: 'repair', childSeatIds: [], team: { layout: 'peer-table', memberSeatIds: [] } } };
      await render({ topology: undefined, officeConfig: config });
      assert.equal(actor()?.getAttribute('data-office-persona'), 'github');
      assert.match(container.querySelector('.live-inspector')?.textContent ?? '', /Configured GitHub/);
      await emit([agent('self'), { ...github, sourceFreshness: 'stale' }]);
      assert.equal(actor()?.getAttribute('data-office-status'), 'unknown');
      await emit([agent('self')]);assert.equal(actor(), null);
      assert.match(container.textContent ?? '', /没有匹配实例/);
    });
    await t.test('config rebinding follows unique epochs, partial binding stays empty, stale callback ignored and teardown clean', async () => {
      const late = [...listeners][0];
      const config: OfficeConfig = { version: 1, seats: [{ id: 'owner', name: 'Configured owner', character: 'self', selector: { sourceId: 'test', instanceId: 'self', epoch: { policy: 'follow-unique' } } }], office: { selfSeatId: 'owner', childSeatIds: [], team: { layout: 'independent-desks', memberSeatIds: [] } } };
      await render({ topology: undefined, officeConfig: config });
      await emit([agent('new-epoch-id', 'working', { identity: { sourceId: 'test', instanceId: 'self', collectorEpoch: 'e3' } })]);
      assert.equal(self(), null); assert.equal(container.querySelectorAll('[data-office-actor]').length, 1);
      assert.equal(container.querySelector('[data-office-actor]')?.getAttribute('data-office-actor'), 'new-epoch-id');
      await emit(snapshot.agents, { identityCoverage: 'partial' });
      assert.equal(container.querySelectorAll('[data-office-actor]').length, 0); assert.match(container.textContent ?? '', /未能安全绑定/);
      const secondListeners = new Set<(state: AdapterState) => void>();
      const second = (): OfficeAdapter => ({ subscribe(listener) { secondListeners.add(listener); listener({ phase: 'disconnected', error: null, snapshot: null }); return () => { secondListeners.delete(listener); }; }, connect() {}, dispose() { disposed++; } });
      await render({ adapterFactory: second });
      await act(async () => late({ phase: 'connected', error: null, snapshot: { receivedAt: '', agents: [agent('self')] } }));
      assert.equal(container.querySelectorAll('[data-office-actor]').length, 0); assert.equal(listeners.size, 0); assert.equal(secondListeners.size, 1);
      await act(async () => root.unmount()); assert.equal(secondListeners.size, 0); assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(media.size, 0); assert.ok(disposed >= 2);
    });
  } finally {
    await act(async () => { try { root.unmount(); } catch {} });
    dom.window.close(); await vite.close();
    for (const [key, value] of Object.entries(original)) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});

test('contract demo partial coverage is explicit and does not shuffle other agents statuses',async()=>{
 const vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 try{
  const {createContractExampleSource,contractExampleConfig}=await vite.ssrLoadModule('/src/LiveOfficeExample.tsx');
  const {bindOffice}=await import('../src/binding.ts');
  const source=createContractExampleSource(),adapter:OfficeAdapter=source.adapterFactory();
  let latest:AdapterState|undefined;const stop=adapter.subscribe(state=>{latest=state;});adapter.connect();
  const before=new Map(latest!.snapshot!.agents.map(agent=>[agent.identity!.instanceId,agent.status]));
  source.setMissing(true);const partial=latest!.snapshot!;
  assert.equal(partial.identityCoverage,'partial');assert.ok(!partial.agents.some(agent=>agent.identity!.instanceId==='self'));
  for(const agent of partial.agents)assert.equal(agent.status,before.get(agent.identity!.instanceId));
  const result=bindOffice(contractExampleConfig('independent-desks'),partial);assert.equal(result.warnings.length,9);assert.equal(result.snapshot.agents.length,0);assert.match(partial.coverage!,/暂停全部自动绑定/);
  source.setMissing(false);assert.equal(bindOffice(contractExampleConfig('independent-desks'),latest!.snapshot!).warnings.length,0);
  stop();adapter.dispose();
 }finally{await vite.close();}
});
