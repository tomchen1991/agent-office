import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAgent } from '../src/core.ts';
import { PRESENCE_MAPPING } from '../src/presenceConfig.ts';
import { residentSeatReport } from '../src/residentLayout.ts';
import { residentPersona } from '../src/residentVisuals.ts';
import { createPresenceSeatAllocator, presenceTopology, providerCharacter, presenceCollaboration, presenceStatus, normalizePresence } from '../src/presence.ts';

test('new arrivals and departures do not move surviving public members', () => {
  const allocate = createPresenceSeatAllocator();
  const topology = (memberIds: string[]) => ({ selfAgentId: 'owner', childAgentIds: [], team: { layout: 'independent-desks' as const, memberIds } });
  const first = allocate(topology(['b', 'c'])).team.seatAssignments!;
  const next = allocate(topology(['a', 'b', 'c'])).team.seatAssignments!;
  assert.equal(next.b, first.b);
  assert.equal(next.c, first.c);
  assert.notEqual(next.a, first.b);
  const departed = allocate(topology(['a', 'c'])).team.seatAssignments!;
  assert.equal(departed.c, first.c);
  const filled = allocate(topology(['a', 'c', 'd'])).team.seatAssignments!;
  assert.equal(filled.d, first.b);
  assert.equal(filled.a, next.a);
  assert.equal(filled.c, first.c);
});

test('restarted dedicated agent takes its own desk, not a public seat', () => {
  const agent = (id: string, fresh: boolean): OfficeAgent => ({ id, name: id, character: 'github', status: fresh ? 'idle' : 'unknown', sourceFreshness: fresh ? 'fresh' : 'stale', source: 'auto-fix-main', observedAt: null, latestUserRequest: null });
  const old = agent('old', false), current = agent('new', true);
  const topology = presenceTopology([old, current]);
  assert.equal(topology.githubAgentId, 'new');
  assert.deepEqual(topology.team.memberIds, []);
  assert.equal(presenceTopology([current, agent('other', true)]).githubAgentId, undefined);
  assert.equal(presenceTopology([old]).githubAgentId, 'old');
  const expiredPi: OfficeAgent = { ...old, id: 'expired-pi', character: 'chatgpt' };
  const activePi: OfficeAgent = { ...current, id: 'active-pi', character: 'grok' };
  assert.deepEqual(presenceTopology([expiredPi, activePi]).team.memberIds, ['active-pi']);
});

test('configured get-news source uses the hotspot desk without changing status or model appearance', () => {
  const row = (instanceId: string, freshness = 'fresh', status = 'idle') => ({
    sourceId: 'get-news-worker', instanceId, freshness, status, ageMs: freshness === 'fresh' ? 100 : 171000,
    data: { instance_id: instanceId, member_name: '热点获取 Agent（Worker）', provider: 'openai' },
  });
  const frame = (instances: unknown[]) => ({ version: 1, persistence: 'memory', complete: true, processId: 'epoch', staleAfterMs: 45000, instances });
  const normalize = (instances: unknown[]) => normalizePresence(frame(instances), { sourceKinds: PRESENCE_MAPPING.sourceKinds });
  const id = JSON.stringify(['get-news-worker', 'current']);
  const next = normalize([row('current')]);
  assert.equal(next.topology.hotspotAgentId, id);
  assert.deepEqual(next.topology.team.memberIds, []);
  assert.deepEqual(next.topology.team.seatAssignments, {});
  assert.equal(residentSeatReport(next.topology).assignments[id], 'hotspot-desk');
  assert.equal(next.snapshot.agents[0].character, 'chatgpt');
  assert.equal(residentPersona(id, 'chatgpt', next.topology), 'hotspot');
  const stale = normalize([row('current', 'stale', 'unknown')]);
  assert.equal(stale.topology.hotspotAgentId, id);
  assert.equal(stale.snapshot.agents[0].sourceFreshness, 'stale');
  assert.equal(stale.snapshot.agents[0].status, 'unknown');
  assert.equal(normalize([row('old', 'stale', 'unknown'), row('current')]).topology.hotspotAgentId, id);
  assert.equal(normalize([row('old', 'fresh', 'stopping'), row('current')]).topology.hotspotAgentId, id);
  const ambiguous = normalize([row('other'), row('current')]);
  assert.equal(ambiguous.topology.hotspotAgentId, undefined);
  assert.deepEqual(ambiguous.topology.team.memberIds, []);
  assert.equal(normalize([]).topology.hotspotAgentId, undefined);
  // Neither a matching display name nor a model provider assigns resident identity.
  assert.equal(normalizePresence(frame([row('current')])).topology.hotspotAgentId, undefined);
});

test('presence stopping maps to offline and retains its seat through departure and expiry', async () => {
  const { advanceLiveOffice, reconcileLiveOffice } = await import('../src/liveOfficeMotion.ts');
  const { displayStatus } = await import('../src/core.ts');
  const allocate = createPresenceSeatAllocator();
  const agent: OfficeAgent = { id: 'pi', name: 'PI', character: 'chatgpt', status: 'working', sourceFreshness: 'fresh', validForMs: 5000, source: 'pi', observedAt: null, latestUserRequest: null };
  const first = allocate(presenceTopology([agent]), [agent]);
  const target = { id: agent.id, identityKey: 'pi/epoch', seatKey: first.team.seatAssignments![agent.id], status: agent.status };
  let actors = advanceLiveOffice(reconcileLiveOffice([], [target]), 6000);
  const stopped = { ...agent, status: presenceStatus('stopping') };
  assert.equal(stopped.status, 'offline');
  for (const status of ['idle', 'working', 'waiting', 'unknown'] as const) assert.equal(presenceStatus(status), status);
  const topology = allocate(presenceTopology([stopped]), [stopped]);
  assert.equal(topology.team.seatAssignments![agent.id], target.seatKey);
  actors = reconcileLiveOffice(actors, [{ ...target, status: displayStatus(stopped, 0, 'connected') }]);
  assert.equal(actors[0].phase, 'stand');
  actors = advanceLiveOffice(actors, 2000);
  assert.equal(actors[0].phase, 'exit');
  const stale = { ...stopped, sourceFreshness: 'stale' as const };
  assert.equal(allocate(presenceTopology([stale]), [stale]).team.seatAssignments![agent.id], target.seatKey);
  actors = reconcileLiveOffice(actors, [{ ...target, status: displayStatus(stale, 6000, 'connected') }]);
  actors = advanceLiveOffice(actors, 4000);
  assert.deepEqual(actors, []);
  assert.deepEqual(reconcileLiveOffice(actors, [{ ...target, status: stopped.status }]), []);
  assert.equal(reconcileLiveOffice(actors, [target])[0].phase, 'arrival');
  assert.deepEqual(allocate(presenceTopology([])).team.seatAssignments, {});
});

test('live dedicated replacement wins over a retained stopping instance', () => {
  const stopped: OfficeAgent = { id: 'old', name: 'old', character: 'github', status: presenceStatus('stopping'), sourceFreshness: 'fresh', source: 'github', observedAt: null, latestUserRequest: null };
  assert.equal(presenceTopology([stopped]).githubAgentId, 'old');
  assert.equal(presenceTopology([stopped, { ...stopped, id: 'new', status: 'idle' }]).githubAgentId, 'new');
});

test('registered collaboration survives idle task types without guessing from repo or arbitrary names', () => {
  assert.deepEqual(presenceCollaboration({ member_name: 'DeckZ 协作 PI', task_type: null, task_name: '工时平台开发' }), { group: '工时平台开发' });
  assert.deepEqual(presenceCollaboration({ member_name: 'DeckZ 长线协作 PI', task_type: 'requirements', task_name: null }), { group: null });
  assert.deepEqual(presenceCollaboration({ member_name: 'custom', task_name: 'finance' }, 'pi-collaboration'), { group: 'finance' });
  assert.deepEqual(presenceCollaboration({ member_name: 'custom', task_type: 'coding_collaboration', task_name: 'finance' }), { group: 'finance' });
  assert.equal(presenceCollaboration({ member_name: 'DeckZ PI', task_name: '工时平台开发' }), undefined);
  assert.equal(presenceCollaboration({ member_name: 'fake 协作 PI', task_name: 'finance' }), undefined);
});

test('two reported groups get separate stable tables; ordinary PI keeps its desk', () => {
  const allocate = createPresenceSeatAllocator();
  const agent = (id: string, group?: string): OfficeAgent => ({ id, name: id, character: 'chatgpt', status: 'idle', sourceFreshness: 'fresh', source: 'pi', observedAt: null, latestUserRequest: null, ...(group ? { collaboration: { group } } : {}) });
  const ordinary = agent('ordinary');
  const before = allocate(presenceTopology([ordinary]), [ordinary]).team.seatAssignments!;
  const agents = [ordinary, agent('a', '工时'), agent('b', '工时'), agent('c', '财务'), agent('d', '财务')];
  const first = allocate(presenceTopology(agents), agents).team.seatAssignments!;
  assert.equal(first.ordinary, before.ordinary);
  assert.match(first.a, /^public-table-1-/);
  assert.match(first.b, /^public-table-1-/);
  assert.match(first.c, /^public-table-2-/);
  assert.match(first.d, /^public-table-2-/);
  assert.equal(new Set(Object.values(first)).size, 5);
  const changed = [...agents.filter(a => a.id !== 'a'), agent('new', '工时')];
  const next = allocate(presenceTopology(changed), changed).team.seatAssignments!;
  assert.equal(next.b, first.b);
  assert.equal(next.c, first.c);
  assert.equal(next.new, first.a);
  // Oversized/third groups never silently share another group's reserved table.
  const crowded = [...changed, agent('e', '工时'), agent('f', '工时'), agent('g', 'third')];
  const overflow = allocate(presenceTopology(crowded), crowded).team.seatAssignments!;
  assert.match(overflow.f, /^public-desk-/);
  assert.match(overflow.g, /^public-desk-/);
  const stale = crowded.map(a => a.id === 'c' ? { ...a, sourceFreshness: 'stale' as const } : a);
  assert.equal(allocate(presenceTopology(stale), stale).team.seatAssignments!.c, undefined);
});

test('provider selects appearance without guessing unknown vendors', () => {
  assert.equal(providerCharacter('openai-codex'), 'chatgpt');
  assert.equal(providerCharacter(' OpenAI '), 'chatgpt');
  assert.equal(providerCharacter('deepseek'), 'deepseek');
  assert.equal(providerCharacter('xai'), 'grok');
  assert.equal(providerCharacter('anthropic'), undefined);
  assert.equal(providerCharacter(null), undefined);
  assert.equal(providerCharacter('proxy-openai-unknown'), undefined);
});

test('raw collector snapshots are normalized locally, honoring explicit public mappings', () => {
  const row = { sourceId: 'main', instanceId: 'one', status: 'idle', freshness: 'fresh', ageMs: 100,
    receivedAt: '2026-01-01T00:00:00Z', data: { instance_id: 'one', member_name: 'Main', provider: 'openai', private_field: 'ignored' } };
  const frame = { version: 1, persistence: 'memory', complete: true, processId: 'epoch', staleAfterMs: 45000, instances: [row] };
  const next = normalizePresence(frame, { sourceKinds: { main: 'self' }, sourceLabels: { main: 'Main source' } });
  assert.equal(next.topology.selfAgentId, JSON.stringify(['main', 'one']));
  assert.equal(next.snapshot.agents[0].character, 'self');
  assert.equal(next.snapshot.agents[0].sourceLabel, 'Main source');
  assert.equal(next.snapshot.agents[0].validForMs, 44900);
  assert.equal(next.snapshot.agents[0].identity?.collectorEpoch, 'epoch');
  assert.ok(!JSON.stringify(next).includes('private_field'));
  assert.equal(normalizePresence(frame).snapshot.agents[0].character, 'chatgpt');
  assert.equal(normalizePresence(frame, { instanceCharacters: { '["main","one"]': 'github' } }).snapshot.agents[0].character, 'github');
  for (const invalid of [null, {}, { ...frame, complete: false }, { ...frame, instances: [row, row] },
    { ...frame, instances: [{ ...row, ageMs: -1 }] }, { ...frame, instances: [{ ...row, staleAfterMs: 'bad' }] },
    { ...frame, instances: [{ ...row, data: { ...row.data, instance_id: 'mismatch' } }] }]) {
    assert.throws(() => normalizePresence(invalid));
  }
  assert.deepEqual(normalizePresence({ ...frame, instances: [] }).snapshot.agents, []);
});
