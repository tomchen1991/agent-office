import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeAdapter, createOfficePreloadApi, exposeOfficePreload } from '../src/bridge.ts';
import type { OfficeIpcRenderer } from '../src/bridge.ts';
import type { AdapterState } from '../src/core.ts';
import { OFFICE_BRIDGE_CHANNELS, OFFICE_BRIDGE_ERROR } from '../src/bridgeProtocol.ts';
import type { OfficeBridgeApi, OfficeBridgeCommand } from '../src/bridgeProtocol.ts';

const connected = (): AdapterState => ({phase: 'connected', error: null, snapshot: {agents: [], receivedAt: '2026-01-01T00:00:00Z', identityCoverage: 'complete'}});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class Renderer implements OfficeIpcRenderer {
  commands: OfficeBridgeCommand[] = [];
  listeners = new Set<(event: unknown, payload: unknown) => void>();
  reply: () => Promise<unknown> = async () => ({ok: true});
  invoke(channel: string, command: OfficeBridgeCommand) { assert.equal(channel, OFFICE_BRIDGE_CHANNELS.control); this.commands.push(command); return this.reply(); }
  on(channel: string, listener: (event: unknown, payload: unknown) => void) { assert.equal(channel, OFFICE_BRIDGE_CHANNELS.state); this.listeners.add(listener); }
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void) { assert.equal(channel, OFFICE_BRIDGE_CHANNELS.state); this.listeners.delete(listener); }
  emit(subscriptionId: number, state: unknown = connected()) { for (const listener of this.listeners) listener({sender: 'SECRET ELECTRON OBJECT'}, {subscriptionId, state}); }
}

test('preload exposes only a narrow frozen subscribe API, never Electron objects or IPC events', async () => {
  const ipc = new Renderer(); let exposed: OfficeBridgeApi | undefined;
  const api = exposeOfficePreload({exposeInMainWorld(key, value) { assert.equal(key, 'agentOffice'); exposed = value; }}, ipc);
  assert.equal(exposed, api); assert.deepEqual(Object.keys(api), ['subscribe']); assert.equal(Object.isFrozen(api), true);
  const calls: unknown[][] = [];
  const cancel = api.subscribe((...args) => { calls.push(args); });
  ipc.emit(1, {...connected(), token: 'SECRET'});
  assert.deepEqual(calls, [[connected()]]); assert.equal(JSON.stringify(calls).includes('SECRET'), false);
  cancel(); cancel(); await flush();
  assert.equal(ipc.listeners.size, 0);
  assert.deepEqual(ipc.commands, [{action: 'subscribe', subscriptionId: 1}, {action: 'unsubscribe', subscriptionId: 1}]);
});

test('preload shares one subscription, isolates callback mutations, and cancels duplicate callbacks independently', async () => {
  const ipc = new Renderer(); const api = createOfficePreloadApi(ipc);
  const first: AdapterState[] = []; const second: AdapterState[] = [];
  const callback = (state: AdapterState) => { first.push(state); state.phase = 'disconnected'; };
  const cancelA = api.subscribe(callback); const cancelB = api.subscribe(callback); const cancelC = api.subscribe(value => second.push(value));
  assert.equal(ipc.listeners.size, 1); ipc.emit(1);
  assert.equal(first.length, 2); assert.equal(second[0].phase, 'connected');
  cancelA(); ipc.emit(1); assert.equal(first.length, 3);
  cancelB(); assert.equal(ipc.listeners.size, 1); cancelC(); await flush();
  assert.equal(ipc.commands.length, 2); assert.equal(ipc.listeners.size, 0);
});

test('preload subscription churn coalesces while IPC is pending and rejects stale event generations', async () => {
  const ipc = new Renderer(); const api = createOfficePreloadApi(ipc);
  let release!: (value: unknown) => void;
  ipc.reply = () => new Promise(resolve => { release = resolve; });
  const stopFirst = api.subscribe(() => {}); stopFirst();
  let received = 0; let stop = () => {};
  for (let index = 0; index < 100; index++) { stop(); stop = api.subscribe(() => { received++; }); }
  assert.equal(ipc.commands.length, 1); assert.equal(ipc.listeners.size, 1);
  const latestId = 101;
  ipc.emit(1); assert.equal(received, 0); ipc.emit(latestId); assert.equal(received, 1);
  ipc.reply = async () => ({ok: true}); release({ok: true}); await flush();
  assert.deepEqual(ipc.commands.at(-1), {action: 'subscribe', subscriptionId: latestId});
  stop(); await flush(); assert.deepEqual(ipc.commands.at(-1), {action: 'unsubscribe', subscriptionId: latestId});
  assert.equal(ipc.commands.length, 3); assert.equal(ipc.listeners.size, 0);
});

test('preload sanitizes invalid messages, failed commands, and thrown errors without secret propagation', async () => {
  const ipc = new Renderer(); ipc.reply = async () => { throw new Error('SECRET'); };
  const api = createOfficePreloadApi(ipc); const states: AdapterState[] = [];
  const stop = api.subscribe(value => states.push(value)); await flush();
  assert.equal(states.at(-1)!.error, OFFICE_BRIDGE_ERROR);
  ipc.emit(1, {phase: 'connected', snapshot: 'SECRET', error: null});
  assert.equal(states.at(-1)!.phase, 'disconnected');
  for (const listener of ipc.listeners) { listener({}, {subscriptionId: -1, state: connected()}); listener({}, null); }
  assert.equal(JSON.stringify(states).includes('SECRET'), false); stop(); await flush();
});

test('preload bounds listeners and isolates callback errors', async () => {
  const ipc = new Renderer(); const api = createOfficePreloadApi(ipc); const cancels: (() => void)[] = [];
  for (let index = 0; index < 64; index++) cancels.push(api.subscribe(() => { throw new Error('consumer error'); }));
  assert.throws(() => api.subscribe(() => {}), {message: OFFICE_BRIDGE_ERROR});
  assert.doesNotThrow(() => ipc.emit(1)); for (const cancel of cancels) cancel(); await flush(); assert.equal(ipc.listeners.size, 0);
});

test('renderer adapter supports Strict Mode setup/cleanup/setup and discards late callbacks', () => {
  const callbacks: ((value: AdapterState) => void)[] = []; let canceled = 0;
  const adapter = createBridgeAdapter({subscribe(listener) { callbacks.push(listener); return () => { canceled++; }; }});
  const states: AdapterState[] = []; const unsubscribe = adapter.subscribe(value => states.push(value));
  assert.equal(states[0].phase, 'disconnected'); adapter.connect(); adapter.connect(); assert.equal(callbacks.length, 1);
  callbacks[0](connected()); assert.equal(states.at(-1)!.phase, 'connected');
  adapter.dispose(); adapter.dispose(); assert.equal(canceled, 1); assert.equal(states.at(-1)!.snapshot, null);
  adapter.connect(); assert.equal(callbacks.length, 2); callbacks[0](connected()); assert.equal(states.at(-1)!.phase, 'connecting');
  callbacks[1](connected()); assert.equal(states.at(-1)!.phase, 'connected');
  unsubscribe(); adapter.dispose(); assert.equal(canceled, 2);
});

test('renderer adapter is reusable after failures and reentrant dispose cancels synchronously acquired subscriptions', () => {
  let shouldThrow = true; let canceled = 0;
  const adapter = createBridgeAdapter({subscribe(listener) { if (shouldThrow) throw new Error('SECRET'); listener(connected()); return () => { canceled++; }; }});
  const states: AdapterState[] = [];
  adapter.subscribe(value => { states.push(value); if (value.phase === 'connected') adapter.dispose(); });
  adapter.connect(); assert.equal(states.at(-1)!.error, OFFICE_BRIDGE_ERROR); assert.equal(JSON.stringify(states).includes('SECRET'), false);
  shouldThrow = false; adapter.connect(); assert.equal(states.at(-1)!.phase, 'disconnected'); assert.equal(canceled, 1);
});

test('renderer adapter and preload use only fixed commands across a complete reconnect cycle', async () => {
  const ipc = new Renderer(); const adapter = createBridgeAdapter(createOfficePreloadApi(ipc));
  const states: AdapterState[] = []; adapter.subscribe(state => states.push(state));
  adapter.connect(); ipc.emit(1); adapter.dispose(); await flush();
  adapter.connect(); ipc.emit(2); assert.equal(states.at(-1)!.phase, 'connected');
  adapter.dispose(); await flush();
  assert.deepEqual(ipc.commands.map(command => command.action), ['subscribe', 'unsubscribe', 'subscribe', 'unsubscribe']);
  for (const command of ipc.commands) assert.deepEqual(Object.keys(command).sort(), ['action', 'subscriptionId']);
});

function freshState(): AdapterState {
  return {...connected(), snapshot: {...connected().snapshot!, agents: [{id: 'a', name: 'Agent', source: 'host', status: 'working', character: 'self',
    observedAt: '2026-01-01T00:00:00Z', latestUserRequest: null, sourceFreshness: 'fresh', validForMs: 1000}]}};
}
test('preload replay consumes elapsed monotonic TTL instead of reviving a cached working agent', async () => {
  let now = 0; const ipc = new Renderer(); const api = createOfficePreloadApi(ipc, {now: () => now});
  const stops = [api.subscribe(() => {})]; ipc.emit(1, freshState());
  now = 600.2; const states: AdapterState[] = []; stops.push(api.subscribe(value => states.push(value)));
  assert.equal(states.at(-1)!.snapshot!.agents[0].validForMs, 399);
  now = 1000; stops.push(api.subscribe(value => states.push(value)));
  assert.equal(states.at(-1)!.snapshot!.agents[0].sourceFreshness, 'stale');
  assert.equal(states.at(-1)!.snapshot!.agents[0].status, 'unknown');
  now = -1; stops.push(api.subscribe(value => states.push(value)));
  assert.equal(states.at(-1)!.snapshot!.agents[0].sourceFreshness, 'unknown');
  for (const stop of stops) stop(); await flush();
});

test('renderer adapter cached replay also ages TTL and retains original receipt across new listeners', () => {
  let now = 0; let emit!: (state: AdapterState) => void;
  const adapter = createBridgeAdapter({subscribe(listener) { emit = listener; return () => {}; }}, {now: () => now});
  adapter.connect(); emit(freshState()); now = 800;
  const states: AdapterState[] = []; adapter.subscribe(value => states.push(value));
  assert.equal(states.at(-1)!.snapshot!.agents[0].validForMs, 200);
  now = 999.1; adapter.subscribe(value => states.push(value));
  assert.equal(states.at(-1)!.snapshot!.agents[0].sourceFreshness, 'stale');
  now = 1400; adapter.subscribe(value => states.push(value));
  assert.equal(states.at(-1)!.snapshot!.agents[0].status, 'unknown'); adapter.dispose();
});
