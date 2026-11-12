import test from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus } from '../src/core.ts';
import { normalizePresence, createPresenceSeatAllocator } from '../src/presence.ts';
import { PRESENCE_MAPPING } from '../src/presenceConfig.ts';
import { createOnDemandPresenceTracker } from '../src/onDemandPresence.ts';
import { residentSeatReport } from '../src/residentLayout.ts';
import { advanceLiveOffice, reconcileLiveOffice } from '../src/liveOfficeMotion.ts';

const row = (status: string, instanceId = 'invocation', ageMs = 0, freshness = 'fresh') => ({
  sourceId: 'get-news-worker', instanceId, status, ageMs, freshness,
  receivedAt: '2026-01-01T00:00:00Z',
  data: { instance_id: instanceId, member_name: '热点获取 Agent（Worker）' },
});
function setup() {
  let at = 0;
  const track = createOnDemandPresenceTracker(() => at);
  const allocate = createPresenceSeatAllocator();
  const next = (instances: unknown[], processId = 'epoch') => normalizePresence({
    version: 1, persistence: 'memory', complete: true, processId, staleAfterMs: 45000, instances,
  }, PRESENCE_MAPPING, allocate, track);
  return { next, tick: (ms: number) => { at += ms; } };
}

test('on-demand Worker stays at its dedicated desk before invocation and after stopping/expiry', () => {
  const { next, tick } = setup();
  const initial = next([]);
  const agent = initial.snapshot.agents[0];
  assert.equal(displayStatus(agent, 86400000, 'connected'), 'idle');
  assert.equal(agent.observedAt, null);
  assert.equal(agent.sourceFreshness, 'unknown');
  assert.equal(residentSeatReport(initial.topology).assignments[agent.id], 'hotspot-desk');
  const working = next([row('working')]).snapshot.agents[0];
  assert.equal(working.id, agent.id);
  assert.deepEqual(working.identity, agent.identity);
  assert.equal(displayStatus(working, 0, 'connected'), 'working');
  const stopped = next([row('stopping')]).snapshot.agents[0];
  assert.equal(displayStatus(stopped, 86400000, 'connected'), 'idle');
  const target = (a: typeof agent) => ({ id: a.id, identityKey: JSON.stringify(a.identity), seatKey: 'hotspot-desk', status: displayStatus(a, 0, 'connected') });
  const seated = advanceLiveOffice(reconcileLiveOffice([], [target(working)]), 20000);
  const resting = reconcileLiveOffice(seated, [target(stopped)]);
  assert.equal(resting.length, 1);
  assert.notEqual(resting[0].phase, 'exit');
  assert.notEqual(resting[0].phase, 'stand');
  // Collector may rewrite stopping to unknown before eventually expiring the row.
  // The completion event must survive that same observation becoming stale.
  tick(700000);
  assert.equal(next([row('unknown', 'invocation', 700000, 'stale')]).snapshot.agents[0].status, 'idle');
  const absent = next([], 'restarted-collector').snapshot.agents[0];
  assert.equal(absent.id, agent.id);
  assert.deepEqual(absent.identity, agent.identity);
  assert.equal(displayStatus(absent, 0, 'connected'), 'idle');
  assert.equal(displayStatus(absent, 0, 'disconnected'), 'unknown');
  assert.equal(displayStatus(next([row('working', 'next-invocation')]).snapshot.agents[0], 0, 'connected'), 'working');
});

test('working updates extend a bounded timeout, disappearance never implies completion', () => {
  const { next, tick } = setup();
  const first = next([row('working')]).snapshot.agents[0];
  assert.equal(displayStatus(first, 60000, 'connected'), 'unknown');
  tick(15000);
  const update = next([row('working')]).snapshot.agents[0];
  assert.equal(displayStatus(update, 45000, 'connected'), 'working');
  tick(45000);
  const stale = next([row('unknown', 'invocation', 45000, 'stale')]).snapshot.agents[0];
  assert.equal(displayStatus(stale, 14999, 'connected'), 'working');
  assert.equal(displayStatus(stale, 15000, 'connected'), 'unknown');
  const absent = next([]).snapshot.agents[0];
  assert.equal(displayStatus(absent, 14999, 'connected'), 'working');
  assert.equal(displayStatus(absent, 15000, 'connected'), 'unknown');
  tick(15000);
  assert.equal(next([]).snapshot.agents[0].status, 'unknown');
  assert.equal(next([row('stopping')]).snapshot.agents[0].status, 'idle');
});

test('ambiguous and stale active reports remain unknown; ordinary stopping still exits', () => {
  const { next } = setup();
  assert.equal(next([row('working', 'a'), row('working', 'b')]).snapshot.agents[0].status, 'unknown');
  assert.equal(next([row('unknown', 'a', 171000, 'stale')]).snapshot.agents[0].status, 'unknown');
  const completed = row('unknown', 'completed', 171000, 'stale');
  assert.equal(next([{ ...completed, data: { ...completed.data, status: 'stopping' } }]).snapshot.agents[0].status, 'idle');
  const normal = next([{ ...row('stopping'), sourceId: 'ordinary' }]).snapshot.agents.find(a => a.source === 'ordinary')!;
  assert.equal(normal.presenceMode, undefined);
  assert.equal(displayStatus(normal, 0, 'connected'), 'offline');
});
