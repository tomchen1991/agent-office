import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerOfficeIpc } from '../server/electronBridge.ts';
import type { OfficeIpcEvent, OfficeIpcMain, OfficeMainFrame } from '../server/electronBridge.ts';
import type { AdapterState, OfficeAdapter } from '../src/core.ts';
import { OFFICE_BRIDGE_CHANNELS, OFFICE_BRIDGE_ERROR, OFFICE_BRIDGE_LIMITS, sanitizeBridgeState } from '../src/bridgeProtocol.ts';
import type { OfficeBridgeEvent, OfficeBridgeReply } from '../src/bridgeProtocol.ts';

const url = 'https://office.example/index.html';
const origin = 'https://office.example';
function state(): AdapterState {
  return {phase: 'connected', error: null, snapshot: {receivedAt: '2026-01-01T00:00:00Z', identityCoverage: 'complete', coverage: 'Complete', agents: [
    {id: 'a', name: 'Agent', character: 'self', status: 'working', source: 'source', identity: {sourceId: 'source', instanceId: 'instance', collectorEpoch: 'e1'},
      latestUserRequest: {summary: 'User request', receivedAt: '2026-01-01T00:00:00Z', source: 'user'}, observedAt: '2026-01-01T00:00:00Z', sourceFreshness: 'fresh', validForMs: 10000},
  ]}};
}
class Contents extends EventEmitter {
  destroyed = false;
  loading = false;
  messages: {channel: string; payload: OfficeBridgeEvent}[] = [];
  mainFrame: OfficeMainFrame = {url, origin, send: (channel, payload) => { this.messages.push({channel, payload}); }};
  getURL() { return this.mainFrame.url; }
  isDestroyed() { return this.destroyed; }
  isLoadingMainFrame() { return this.loading; }
}
class Main implements OfficeIpcMain {
  handler: ((event: OfficeIpcEvent, ...args: unknown[]) => OfficeBridgeReply) | null = null;
  removed = 0;
  handle(channel: string, handler: (event: OfficeIpcEvent, ...args: unknown[]) => OfficeBridgeReply) { assert.equal(channel, OFFICE_BRIDGE_CHANNELS.control); this.handler = handler; }
  removeHandler(channel: string) { assert.equal(channel, OFFICE_BRIDGE_CHANNELS.control); this.removed++; this.handler = null; }
  invoke(wc: Contents, command: unknown, frame = wc.mainFrame, ...extra: unknown[]) {
    return this.handler!({sender: wc, senderFrame: frame}, command, ...extra);
  }
}
function harness() {
  const ipc = new Main(); const wc = new Contents();
  const adapters: {connects: number; disposes: number; cancels: number; emit: (value: AdapterState) => void}[] = [];
  const bridge = registerOfficeIpc(ipc);
  const detach = bridge.attachWindow({webContents: wc, allowedDocument: {url, origin}, createAdapter() {
    let listener: (value: AdapterState) => void = () => {};
    const stats = {connects: 0, disposes: 0, cancels: 0, emit: (value: AdapterState) => listener(value)};
    adapters.push(stats);
    return {subscribe(callback) { listener = callback; callback(state()); return () => { stats.cancels++; }; }, connect() { stats.connects++; }, dispose() { stats.disposes++; }};
  }});
  return {ipc, wc, adapters, bridge, detach};
}
const subscribe = (subscriptionId = 1) => ({action: 'subscribe', subscriptionId});
const unsubscribe = (subscriptionId = 1) => ({action: 'unsubscribe', subscriptionId});

test('main bridge creates a main-owned adapter and only sends allowlisted display DTOs', () => {
  const {ipc, wc, adapters, bridge} = harness();
  assert.deepEqual(ipc.invoke(wc, subscribe()), {ok: true});
  assert.equal(adapters[0].connects, 1);
  const raw = state() as AdapterState & {token: string}; raw.token = 'SECRET';
  Object.assign(raw.snapshot!, {raw: {Authorization: 'SECRET'}, collectorURL: 'SECRET'});
  Object.assign(raw.snapshot!.agents[0], {token: 'SECRET', progress: {raw: 'SECRET'}});
  Object.assign(raw.snapshot!.agents[0].identity!, {token: 'SECRET'});
  Object.assign(raw.snapshot!.agents[0].latestUserRequest!, {raw: 'SECRET'});
  adapters[0].emit(raw);
  const sent = wc.messages.at(-1)!;
  assert.equal(sent.channel, OFFICE_BRIDGE_CHANNELS.state);
  assert.equal(JSON.stringify(sent).includes('SECRET'), false);
  assert.deepEqual(sent.payload.state, state());
  raw.snapshot!.agents[0].name = 'mutated after send';
  assert.equal(sent.payload.state.snapshot!.agents[0].name, 'Agent');
  bridge.dispose();
});

test('main rejects foreign windows, subframes, missing frames, URL lookalikes and origin impostors', () => {
  const {ipc, wc, adapters, bridge} = harness();
  assert.equal(ipc.invoke(new Contents(), subscribe()).ok, false);
  assert.equal(ipc.invoke(wc, subscribe(), {...wc.mainFrame}).ok, false);
  assert.equal(ipc.handler!({sender: wc, senderFrame: null}, subscribe()).ok, false);
  for (const hostile of ['https://office.example.evil/index.html', 'https://office.example/elsewhere', `${url}?x=1`, `${url}#x`, 'about:blank', 'blob:https://office.example/id']) {
    Object.assign(wc.mainFrame, {url: hostile}); assert.equal(ipc.invoke(wc, subscribe()).ok, false);
  }
  Object.assign(wc.mainFrame, {url, origin: 'null'});
  assert.equal(ipc.invoke(wc, subscribe()).ok, false);
  Object.assign(wc.mainFrame, {origin});
  const realGetURL = wc.getURL; wc.getURL = () => 'https://attacker.example';
  assert.equal(ipc.invoke(wc, subscribe()).ok, false); wc.getURL = realGetURL;
  assert.equal(adapters.length, 0);
  bridge.dispose();
});

test('only bounded lifecycle commands are accepted; stale unsubscribe cannot stop a new subscription', () => {
  const {ipc, wc, adapters, bridge} = harness();
  const malformed: unknown[] = [null, [], {}, {action: 'connect', subscriptionId: 1}, {action: 'subscribe', subscriptionId: 0}, {action: 'subscribe', subscriptionId: 1.5},
    {action: 'subscribe', subscriptionId: 2_147_483_648}, {action: 'subscribe', subscriptionId: 1, url: 'https://evil'}, {action: 'subscribe', subscriptionId: 1, token: 'SECRET'}];
  for (const command of malformed) assert.deepEqual(ipc.invoke(wc, command), {ok: false, error: OFFICE_BRIDGE_ERROR});
  assert.equal(ipc.invoke(wc, subscribe(), wc.mainFrame, 'extra').ok, false);
  assert.equal(adapters.length, 0);
  ipc.invoke(wc, subscribe()); ipc.invoke(wc, subscribe());
  assert.equal(adapters.length, 1);
  ipc.invoke(wc, subscribe(2));
  assert.equal(adapters[0].cancels, 1); assert.equal(adapters[0].disposes, 1);
  ipc.invoke(wc, unsubscribe(1)); assert.equal(adapters[1].disposes, 0);
  assert.equal(ipc.invoke(wc, subscribe(1)).ok, false);
  ipc.invoke(wc, unsubscribe(2)); ipc.invoke(wc, unsubscribe(2));
  assert.equal(adapters[1].disposes, 1); bridge.dispose();
});

test('main navigation, renderer crash and destruction clean up and block queued old data', () => {
  const {ipc, wc, adapters, bridge} = harness();
  ipc.invoke(wc, subscribe()); const before = wc.messages.length;
  wc.emit('did-start-navigation', {isMainFrame: false}); assert.equal(adapters[0].disposes, 0);
  wc.emit('did-start-navigation', {isMainFrame: true});
  assert.equal(adapters[0].disposes, 1); assert.equal(adapters[0].cancels, 1);
  adapters[0].emit(state()); assert.equal(wc.messages.length, before);
  assert.equal(ipc.invoke(wc, subscribe(2)).ok, false);
  // New same-URL document requires a new main-frame identity, and can start at ID 1.
  const oldFrame = wc.mainFrame;
  wc.mainFrame = {...oldFrame}; wc.emit('did-navigate', {});
  assert.equal(ipc.invoke(wc, subscribe(), oldFrame).ok, false);
  assert.equal(ipc.invoke(wc, subscribe()).ok, true);
  wc.emit('render-process-gone'); assert.equal(adapters[1].disposes, 1);
  assert.equal(ipc.invoke(wc, subscribe(2)).ok, false);
  wc.destroyed = true; wc.emit('destroyed');
  assert.equal(wc.eventNames().length, 0);
  assert.equal(ipc.invoke(wc, subscribe(3)).ok, false);
  bridge.dispose(); bridge.dispose(); assert.equal(ipc.removed, 1);
});

test('navigation to another origin cannot receive stream data or reconnect', () => {
  const {ipc, wc, adapters, bridge} = harness();
  ipc.invoke(wc, subscribe());
  wc.emit('did-start-navigation', {}, 'https://evil.example', false, true);
  Object.assign(wc.mainFrame, {url: 'https://evil.example', origin: 'https://evil.example'});
  wc.emit('did-navigate', {});
  const before = wc.messages.length; adapters[0].emit(state());
  assert.equal(wc.messages.length, before); assert.equal(ipc.invoke(wc, subscribe()).ok, false);
  bridge.dispose();
});

test('same-document navigation invalidates old subscriptions without resetting preload IDs', () => {
  const {ipc, wc, adapters, bridge} = harness(); ipc.invoke(wc, subscribe());
  wc.emit('did-start-navigation', {isMainFrame: true, isSameDocument: true});
  Object.assign(wc.mainFrame, {url: `${url}#section`});
  wc.emit('did-navigate-in-page', {}, `${url}#section`, true);
  assert.equal(adapters[0].disposes, 1); assert.equal(ipc.invoke(wc, subscribe(2)).ok, false);
  wc.emit('did-start-navigation', {isMainFrame: true, isSameDocument: true});
  Object.assign(wc.mainFrame, {url}); wc.emit('did-navigate-in-page', {isMainFrame: true});
  assert.equal(ipc.invoke(wc, subscribe()).ok, false); assert.equal(ipc.invoke(wc, subscribe(2)).ok, true);
  bridge.dispose();
});

test('two windows have isolated adapters and independent cleanup', () => {
  const {ipc, wc, adapters, bridge, detach} = harness();
  const other = new Contents(); let disposed = 0;
  bridge.attachWindow({webContents: other, allowedDocument: {url, origin}, createAdapter: () => ({subscribe(listener) { listener(state()); return () => {}; }, connect() {}, dispose() { disposed++; }})});
  ipc.invoke(wc, subscribe()); ipc.invoke(other, subscribe()); detach(); detach();
  assert.equal(adapters[0].disposes, 1); assert.equal(disposed, 0); assert.equal(other.messages.length, 1);
  bridge.dispose(); assert.equal(disposed, 1);
});

test('raw adapter exceptions and malformed state fail closed without tokens', () => {
  const ipc = new Main(); const wc = new Contents(); const bridge = registerOfficeIpc(ipc);
  bridge.attachWindow({webContents: wc, allowedDocument: {url, origin}, createAdapter() { throw new Error('SECRET'); }});
  assert.deepEqual(ipc.invoke(wc, subscribe()), {ok: false, error: OFFICE_BRIDGE_ERROR}); bridge.dispose();
  for (const bad of [undefined, {}, {phase: 'SECRET'}, {...state(), snapshot: {agents: [], receivedAt: 'invalid'}}, {...state(), error: 'SECRET'}]) {
    const result = sanitizeBridgeState(bad); assert.equal(JSON.stringify(result).includes('SECRET'), false);
    assert.equal(result.error, OFFICE_BRIDGE_ERROR);
  }
});

test('sanitizer bounds agent arrays and text, rejects duplicate IDs, and supports complete paginated snapshots', () => {
  const input = state(); const prototype = input.snapshot!.agents[0];
  input.snapshot!.agents = Array.from({length: OFFICE_BRIDGE_LIMITS.agents}, (_, index) => ({...prototype, id: String(index)}));
  assert.equal(sanitizeBridgeState(input).snapshot!.agents.length, 1312);
  input.snapshot!.agents = [...input.snapshot!.agents, {...prototype, id: 'overflow'}];
  assert.equal(sanitizeBridgeState(input).snapshot, null);
  const duplicate = state(); duplicate.snapshot!.agents = [prototype, prototype];
  assert.equal(sanitizeBridgeState(duplicate).snapshot, null);
  const long = state(); long.snapshot!.agents[0].latestUserRequest!.summary = 'x'.repeat(2001);
  assert.equal(sanitizeBridgeState(long).snapshot!.agents[0].latestUserRequest!.summary.length, 2001);
  long.snapshot!.agents[0].latestUserRequest!.summary = 'x'.repeat(10001);
  assert.equal(sanitizeBridgeState(long).snapshot, null);
  const invalid = state(); invalid.snapshot!.agents[0].validForMs = Infinity;
  assert.equal(sanitizeBridgeState(invalid).snapshot, null);
});

test('registration, host document policy, lifecycle spam and host cleanup are bounded', () => {
  const {ipc, wc, adapters, bridge} = harness();
  assert.throws(() => registerOfficeIpc(ipc));
  const factory = (): OfficeAdapter => ({subscribe() { return () => {}; }, connect() {}, dispose() {}});
  for (const policy of [{url: 'file:///app/index.html', origin: 'null'}, {url: 'http://remote.example/index.html', origin: 'http://remote.example'}, {url, origin: 'https://office.example.evil'}, {url: `${url}?query=1`, origin}]) {
    assert.throws(() => bridge.attachWindow({webContents: new Contents(), allowedDocument: policy, createAdapter: factory}));
  }
  for (let id = 1; id <= 25; id++) ipc.invoke(wc, subscribe(id));
  assert.ok(adapters.length <= 20);
  ipc.invoke(wc, unsubscribe(20)); assert.equal(adapters.at(-1)!.disposes, 1);
  bridge.dispose();
  const replacement = registerOfficeIpc(ipc); replacement.dispose();
});

test('failed and canceled navigation can reconnect the exact surviving document, never a new in-flight navigation', () => {
  const {ipc, wc, adapters, bridge} = harness(); ipc.invoke(wc, subscribe());
  wc.loading = true; wc.emit('did-start-navigation', {isMainFrame: true});
  wc.emit('did-fail-provisional-load', {}, -3, 'Aborted', 'https://evil.example', true);
  assert.equal(ipc.invoke(wc, subscribe(2)).ok, false);
  wc.loading = false; wc.emit('did-stop-loading');
  assert.equal(adapters[0].disposes, 1); assert.equal(ipc.invoke(wc, subscribe(2)).ok, true);
  wc.emit('did-start-navigation', {isMainFrame: true});
  wc.emit('did-fail-load', {}, -2, 'Failed', url, true);
  assert.equal(ipc.invoke(wc, subscribe(3)).ok, true);
  wc.emit('did-start-navigation', {isMainFrame: true});
  Object.assign(wc.mainFrame, {origin: 'null'}); wc.emit('did-stop-loading');
  assert.equal(ipc.invoke(wc, subscribe(4)).ok, false); bridge.dispose();
});

test('sanitizer rejects prototype tricks, sparse arrays and accessors without invoking getters', () => {
  const inherited = Object.create(state()); assert.equal(sanitizeBridgeState(inherited).snapshot, null);
  const sparse = state(); sparse.snapshot!.agents = new Array(1); assert.equal(sanitizeBridgeState(sparse).snapshot, null);
  let accessed = false; const accessor = state();
  Object.defineProperty(accessor, 'token', {enumerable: true, get() { accessed = true; return 'SECRET'; }});
  assert.equal(sanitizeBridgeState(accessor).snapshot, null); assert.equal(accessed, false);
});
