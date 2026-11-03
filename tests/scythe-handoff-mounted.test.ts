import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeSnapshot, OfficeTopology } from '../src/core.ts';
import { actorHasScythe, interruptPersonal, pickupFrame, personalDemo, personalPlacement } from '../src/personalIdle.ts';

test('verified handoff alpha bounds stay inside the owner room and parked prop shares registration', async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { demoCharacters } = await import('../src/demoAssets.ts');
  const { fixedOfficeSeats } = await import('../src/wholeOfficeGeometry.ts');
  const character = demoCharacters.find(item => item.id === 'self')!;
  const seat = fixedOfficeSeats().find(item => item.kind === 'owner')!;
  // RGBA alpha>0 boxes independently measured with Pillow, hashes bind those measurements.
  const assets = [
    { src: character.pickup!.src, sha: '600a1baf3194f2fd30f289e6bf399c6302e28b86d9fc73a31a57cb4098fec26c', boxes: [[65, 10, 448, 498], [65, 17, 448, 487], [65, 7, 448, 497], [77, 8, 472, 505]] },
    { src: character.parkedScythe!.src, sha: '610d6efa06dd96d0ee731fef8ada36530fb28b2f0f8a19b7180ae9ef57581e6f', boxes: [[68, 20, 423, 511]] },
  ];
  const placement = personalPlacement(seat, character, { phase: 'pickup', elapsedMs: 0 });
  for (const asset of assets) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../public/${asset.src}`, import.meta.url))).digest('hex'), asset.sha, 'Reinspect alpha when artwork changes');
    for (const [left, top, right, bottom] of asset.boxes) {
      assert.ok(placement.x + (left / 512 - placement.contactX) * placement.width >= 49);
      assert.ok(placement.x + (right / 512 - placement.contactX) * placement.width <= 650);
      assert.ok(placement.y + (top / 512 - placement.contactY) * placement.width >= 120);
      assert.ok(placement.y + (bottom / 512 - placement.contactY) * placement.width <= 1000);
    }
  }
});

test('pickup reversal preserves every contact boundary and ownership', () => {
  for (const elapsedMs of [0, 249, 250, 499, 500, 749, 750, 999]) {
    const action = { phase: 'pickup' as const, elapsedMs };
    const reverse = interruptPersonal(action)!;
    assert.equal(pickupFrame(reverse), pickupFrame(action), `frame at ${elapsedMs}`);
    assert.equal(actorHasScythe(reverse), actorHasScythe(action), `ownership at ${elapsedMs}`);
  }
});

test('independent mounted scythe lifecycle: one prop, freeze, return, replacement, and cancellation', async t => {
  const vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const keys = ['window', 'document', 'HTMLElement', 'Image', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const images: { src: string; finish: () => void }[] = [];
  class FakeImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(src: string) { images.push({ src, finish: () => this.onload?.() }); } }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Image: FakeImage, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let now = 0, handle = 0, reduced = false, generation = 0, disposed = 0;
  const frames = new Map<number, FrameRequestCallback>(), timers = new Map<number, () => void>(), media = new Set<() => void>();
  Object.defineProperty(dom.window.performance, 'now', { value: () => now });
  Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => media.add(fn), removeEventListener: (_: string, fn: () => void) => media.delete(fn) }) });
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollBy = () => {};
  dom.window.requestAnimationFrame = fn => { frames.set(++handle, fn); return handle; };
  dom.window.cancelAnimationFrame = id => { frames.delete(id); };
  dom.window.setInterval = ((fn: () => void) => { timers.set(++handle, fn); return handle; }) as typeof dom.window.setInterval;
  dom.window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
  const container = dom.window.document.getElementById('root')!, root = createRoot(container);
  const listeners = new Set<(state: AdapterState) => void>();
  const agent = (status: OfficeAgent['status'] = 'idle', patch: Partial<OfficeAgent> = {}): OfficeAgent => ({ id: 'self', name: 'Owner', character: 'self', status, latestUserRequest: null, source: 'handoff-test', observedAt: '2026-11-03T00:00:00Z', sourceFreshness: 'fresh', validForMs: 999999, identity: { sourceId: 'handoff', instanceId: 'self', collectorEpoch: 'e1' }, ...patch });
  let snapshot: OfficeSnapshot = { receivedAt: '2026-11-03T00:00:00Z', identityCoverage: 'complete', agents: [agent()] };
  const makeFactory = () => (): OfficeAdapter => ({ subscribe(fn) { listeners.add(fn); fn({ phase: 'connected', error: null, snapshot }); return () => { listeners.delete(fn); }; }, connect() {}, dispose() { disposed++; } });
  let factory = makeFactory();
  let characters: unknown = undefined;
  let topology: OfficeTopology = { selfAgentId: 'self', childAgentIds: [], team: { layout: 'independent-desks', memberIds: [] } };
  const { LiveOffice } = await vite.ssrLoadModule('/src/LiveOffice.tsx');
  const { WholeOfficeScene } = await vite.ssrLoadModule('/src/WholeOfficeScene.tsx');
  const { fixedOfficeSeats } = await vite.ssrLoadModule('/src/wholeOfficeGeometry.ts');
  const { personalPose } = await vite.ssrLoadModule('/src/personalIdle.ts');
  const render = async (finishImages = true) => { await act(async () => root.render(createElement(StrictMode, null, createElement(LiveOffice, { key: generation, adapterFactory: factory, topology, characters })))); if (finishImages) await act(async () => images.splice(0).forEach(image => image.finish())); };
  const emit = async (agents: readonly OfficeAgent[], phase: AdapterState['phase'] = 'connected', extra: Partial<OfficeSnapshot> = {}) => { snapshot = { ...snapshot, ...extra, agents }; await act(async () => listeners.forEach(fn => fn({ phase, snapshot, error: null }))); };
  const step = async (count = 1) => { for (let i = 0; i < count; i++) { now += 100; const jobs = [...frames.values()]; frames.clear(); await act(async () => { jobs.forEach(fn => fn(now)); timers.forEach(fn => fn()); }); } };
  const self = () => container.querySelector('[data-office-seat-kind="owner"][data-office-actor]')!;
  const visual = () => ({ style: self()?.getAttribute('style'), sprite: self()?.querySelector('.wo-sprite')?.getAttribute('style'), phase: self()?.getAttribute('data-office-personal-phase'), owner: container.querySelector('[data-scythe-owner]')?.getAttribute('data-scythe-owner') });
  const oneWeapon = () => { assert.equal(container.querySelectorAll('[data-scythe-owner]').length, 1); assert.equal(container.querySelectorAll('[data-office-seat-kind="owner"][data-office-actor]').length, 1); };
  const setReduced = async (value: boolean) => { await act(async () => { reduced = value; media.forEach(fn => fn()); }); };
  const click = async (text: string) => { const button = [...container.querySelectorAll('button')].find(button => button.textContent === text); assert.ok(button, text); await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const reset = async () => { characters = undefined; reduced = false; generation++; factory = makeFactory(); topology = { selfAgentId: 'self', childAgentIds: [], team: { layout: 'independent-desks', memberIds: [] } }; snapshot = { ...snapshot, identityCoverage: 'complete', agents: [agent()] }; await render(); };
  const reach = async (phase: string) => { for (let i = 0; i < 230; i++) { if (self()?.getAttribute('data-office-personal-phase') === phase) return; await step(); } assert.fail(`Never reached ${phase}`); };
  try {
    await t.test('all exact sampled frames render only the matching weapon owner', async () => {
      const owner = { ...fixedOfficeSeats().find((seat: { kind: string }) => seat.kind === 'owner'), empty: false };
      for (const ms of [0, 1999, 2000, 3199, 3200, 3449, 3450, 3699, 3700, 3949, 3950, 4199, 4200, 6799, 6800, 7049, 7050, 7299, 7300, 7549, 7550, 7799, 7800, 8999, 9000, 10999]) {
        const personal = personalDemo('self', ms)!;
        await act(async () => root.render(createElement(WholeOfficeScene, { layout: 'independent-desks', seats: [owner], canAnimate: true, reducedMotion: false, childCount: 0, floorLabel: '', floorStatus: '', poseForSeat: () => ({ ...personalPose(personal), label: 'test' }) })));
        oneWeapon();
        assert.equal(visual().owner, actorHasScythe(personal) ? 'actor' : 'stand', `at ${ms}`);
        assert.equal(container.querySelectorAll('.wo-scythe-rack').length, 0, 'old duplicate rack removed');
      }
    });
    await t.test('unknown and reduced motion preserve exact style, frame, and ownership in every personal phase', async () => {
      for (const phase of ['rise', 'out', 'pickup', 'scythe', 'putdown', 'back', 'settle']) {
        await reset(); await reach(phase); await step(2); oneWeapon();
        const before = visual();
        await emit([agent('idle', { sourceFreshness: 'stale' })]);
        assert.equal(self()?.getAttribute('data-office-status'), 'unknown');
        assert.deepEqual(visual(), before, `${phase}: stale must not teleport`);
        await step(3); assert.deepEqual(visual(), before); assert.equal(frames.size, 0);
        await emit([agent()]); await setReduced(true);
        assert.deepEqual(visual(), before, `${phase}: reduced motion must not teleport`);
        await step(3); assert.deepEqual(visual(), before); oneWeapon(); assert.equal(frames.size, 0);
      }
    });
    await t.test('work interrupts held weapon through putdown and return before any work screen', async () => {
      await reset(); await reach('scythe'); await step(2); oneWeapon();
      const before = visual();
      await emit([agent('working')]);
      assert.deepEqual(visual(), before, 'recall keeps the current spin frame before finishing its revolution');
      assert.equal(self().getAttribute('data-office-personal-phase'), 'scythe');
      assert.equal(visual().owner, 'actor');
      const phases = new Set<string>();
      for (let i = 0; i < 65 && self().getAttribute('data-office-phase') !== 'seated'; i++) {
        phases.add(self().getAttribute('data-office-personal-phase')!); oneWeapon();
        assert.equal(container.querySelectorAll('.wo-screen-work').length, 0);
        await step();
      }
      assert.ok(phases.has('putdown') && phases.has('back') && phases.has('settle'));
      assert.equal(self().getAttribute('data-office-phase'), 'seated'); assert.equal(visual().owner, 'stand');
      assert.equal(container.querySelectorAll('.wo-screen-work').length, 1);
    });
    await t.test('pause and disconnect hold the same weapon, then recovery returns it', async () => {
      await reset(); await reach('scythe'); const before = visual();
      await click('暂停状态动画'); await step(4); assert.deepEqual(visual(), before);
      await emit([agent('working')], 'disconnected'); assert.deepEqual(visual(), before); oneWeapon();
      await click('继续状态动画'); await step(4); assert.deepEqual(visual(), before);
      await emit([agent('working')]); await step(50); oneWeapon(); assert.equal(visual().owner, 'stand');
    });
    await t.test('collector epoch, identity/topology replacement and adapter swap cannot duplicate or claim old visual is working', async () => {
      for (const change of ['epoch', 'topology', 'adapter']) {
        await reset(); await reach('scythe');
        if (change === 'epoch') await emit([agent('working', { identity: { sourceId: 'handoff', instanceId: 'self', collectorEpoch: 'e2' } })]);
        if (change === 'topology') { topology = { ...topology, selfAgentId: 'replacement' }; await emit([agent('working', { id: 'replacement', identity: { sourceId: 'handoff', instanceId: 'replacement', collectorEpoch: 'e2' } })]); await render(); }
        if (change === 'adapter') { snapshot = { ...snapshot, agents: [agent('working')] }; factory = makeFactory(); await render(); }
        oneWeapon(); assert.equal(self().getAttribute('data-office-status'), 'unknown', change);
        assert.equal(container.querySelectorAll('.wo-screen-work').length, 0, change);
        await step(50); oneWeapon(); assert.equal(visual().owner, 'stand', change);
        assert.ok(['arrival', 'sit'].includes(self().getAttribute('data-office-phase') ?? ''), change);
      }
    });
    await t.test('moving the old owner into a child seat cannot clone its held scythe', async () => {
      await reset(); await reach('scythe');
      topology = { ...topology, selfAgentId: 'replacement', childAgentIds: ['self'] };
      await emit([agent('working'), agent('working', { id: 'replacement', identity: { sourceId: 'handoff', instanceId: 'replacement', collectorEpoch: 'e2' } })]);
      await render(); oneWeapon();
      assert.equal(container.querySelectorAll('[data-office-personal-phase="putdown"], [data-office-personal-phase="scythe"]').length, 1, 'old self must not carry a duplicate held atlas into the child seat');
      const child = container.querySelector('[data-office-actor="self"]');
      assert.notEqual(child?.querySelector('.wo-sprite')?.getAttribute('data-office-sheet'), 'pickup');
      await step(50); oneWeapon(); assert.equal(visual().owner, 'stand');
    });
    await t.test('persona correction retains self artwork only for safe prop return, never substitutes gamepad', async () => {
      for (const character of ['github', 'unknown'] as const) {
        await reset(); await reach('scythe');
        await emit([agent('idle', { character })]); oneWeapon();
        assert.equal(self().getAttribute('data-office-persona'), 'self');
        assert.equal(self().getAttribute('data-office-status'), 'unknown');
        assert.equal(self().getAttribute('data-office-personal-phase'), 'putdown');
        assert.match(self().querySelector('.wo-sprite')?.getAttribute('style') ?? '', /self\/pickup/);
        await step(50); oneWeapon(); assert.equal(visual().owner, 'stand');
        assert.equal(self().getAttribute('data-office-persona'), character);
      }
    });
    await t.test('optional atlas replacement cannot hide or substitute a currently held weapon', async () => {
      await reset(); await reach('scythe');
      const { demoCharacters } = await vite.ssrLoadModule('/src/demoAssets.ts');
      characters = demoCharacters.map((item: { id: string; extra?: { src: string } }) => item.id === 'self' ? { ...item, extra: { ...item.extra, src: 'assets/demo/self/replacement-extra.png' } } : item);
      await render(false); oneWeapon();
      assert.equal(visual().owner, 'actor');
      assert.equal(self().getAttribute('data-office-persona'), 'self');
      assert.doesNotMatch(self().querySelector('.wo-sprite')?.getAttribute('style') ?? '', /replacement-extra/);
      await act(async () => images.splice(0).forEach(image => image.finish()));
      await step(50); oneWeapon(); assert.equal(visual().owner, 'stand');
    });
    await t.test('missing observation holds ownership without invented departure or work', async () => {
      await reset(); await reach('scythe'); const before = visual();
      await emit([], 'connected', { identityCoverage: 'partial' }); await step(10);
      assert.deepEqual(visual(), before); oneWeapon(); assert.equal(self().getAttribute('data-office-status'), 'unknown');
    });
    await t.test('optional pickup arriving late cannot start an unready leisure action', async () => {
      reduced = false; generation++; snapshot = { ...snapshot, agents: [agent()] }; await render(false);
      const delayed = images.filter(image => /pickup|parked/.test(image.src));
      const ready = images.filter(image => !/pickup|parked/.test(image.src)); images.length = 0;
      await act(async () => ready.forEach(image => image.finish())); await step(170);
      assert.equal(self().getAttribute('data-office-phase'), 'seated');
      await act(async () => delayed.forEach(image => image.finish()));
      assert.equal(self().getAttribute('data-office-phase'), 'seated');
      await reach('pickup'); oneWeapon();
    });
  } finally {
    const oldCallbacks = [...frames.values()];
    await act(async () => root.unmount());
    assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(listeners.size, 0); assert.ok(disposed > 0);
    await act(async () => oldCallbacks.forEach(fn => fn(now + 100)));
    assert.equal(container.children.length, 0);
    await vite.close(); dom.window.close();
    for (const key of keys) { const descriptor = originals[key]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
