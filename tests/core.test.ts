import test from 'node:test';
import assert from 'node:assert/strict';
import { freshness, validateTopology, displayStatus } from '../src/core.ts';
import { createMockAdapter, demoTopology, mockSnapshot } from '../src/mock.ts';
import type { AdapterState } from '../src/core.ts';
const now = Date.parse('2026-01-01T00:00:00Z');
test('mock snapshot deterministic and missing requests never synthesized', () => {
  assert.deepEqual(mockSnapshot(now), mockSnapshot(now));
  assert.equal(mockSnapshot(now).agents.find(a => a.id === 'grok')?.latestUserRequest, null);
});
test('freshness uses source assertion and elapsed local receipt age, not wall clocks', () => {
  const agent = mockSnapshot(now).agents[0];
  assert.equal(freshness(agent, 0), 'fresh');
  assert.equal(freshness(agent, 30_000), 'stale');
  assert.equal(freshness({...agent, observedAt: '1990-01-01', validForMs: 90_000}, 60_000), 'fresh');
  assert.equal(freshness({...agent, observedAt: '2099-01-01'}, 0), 'fresh');
  assert.equal(freshness({...agent, sourceFreshness: 'unknown'}, 0), 'unknown');
  assert.equal(freshness({...agent, sourceFreshness: 'stale'}, 0), 'stale');
  assert.equal(freshness(agent, -1), 'unknown');
});
test('topology explicit leader membership and unique identities', () => {
  assert.doesNotThrow(() => validateTopology(demoTopology));
  assert.throws(() => validateTopology({...demoTopology, childAgentIds: ['self']}));
  assert.throws(() => validateTopology({...demoTopology, team: {...demoTopology.team, leaderId: 'absent'}}));
  assert.doesNotThrow(() => validateTopology({...demoTopology, team: { layout:'peer-table', memberIds: [] }}));
});
test('mock connect idempotent, unsubscribe isolated, dispose/reconnect reusable', () => {
  const adapter = createMockAdapter(() => now);
  const states: AdapterState[] = [];
  const unsubscribe = adapter.subscribe(state => states.push(state));
  adapter.connect(); adapter.connect();
  assert.deepEqual(states.map(s => s.phase), ['disconnected', 'connected']);
  adapter.dispose(); adapter.connect();
  assert.equal(states.at(-1)?.phase, 'connected');
  unsubscribe(); const count = states.length;
  adapter.dispose(); assert.equal(states.length, count);
});

test('renderer source has no server imports or credential variable references', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const files = await readdir(new URL('../src/', import.meta.url));
  for (const name of files.filter(name => /\.[tj]sx?$/.test(name))) {
    const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*server\//);
    assert.doesNotMatch(source, /COLLECT_CONSUMER_TOKEN|VITE_.*TOKEN/);
  }
});

test('disconnected or elapsed stale cache never displays working badge', () => {
  const agent = {...mockSnapshot(now).agents[0], status: 'working' as const};
  assert.equal(displayStatus(agent, 0, 'connected'), 'working');
  assert.equal(displayStatus(agent, 0, 'disconnected'), 'unknown');
  assert.equal(displayStatus(agent, 30_000, 'connected'), 'unknown');
});

test('pure public entry remains loadable without React TSX or Node credentials',async()=>{
 const api=await import('../src/index.ts');
 assert.equal(typeof api.bindOffice,'function');assert.equal(typeof api.createBridgeAdapter,'function');
});
