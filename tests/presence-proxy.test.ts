import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAgent } from '../src/core.ts';
import { createPresenceSeatAllocator, presenceTopology, presenceProxy, providerCharacter, presenceCollaboration, presenceStatus } from '../server/presenceProxy.ts';

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

test('presence backend rejects foreign origins and does not expose missing config paths', async () => {
  let handler: any;
  const plugin = presenceProxy();
  (plugin.configureServer as Function)({ middlewares: { use(_path: string, fn: any) { handler = fn; } } });
  async function request(headers: Record<string, string>) {
    let body = '';
    const res = { statusCode: 200, setHeader() {}, end(value: string) { body = value; } };
    await handler({ method: 'GET', url: '/', headers }, res);
    return { code: res.statusCode, body };
  }
  assert.equal((await request({ host: 'evil.example' })).code, 403);
  assert.equal((await request({ host: 'localhost:5188', origin: 'https://evil.example' })).code, 403);
  const before = process.env.OFFICE_PRESENCE_CONFIG;
  process.env.OFFICE_PRESENCE_CONFIG = '/nonexistent/private-presence-test.json';
  try {
    const result = await request({ host: '127.0.0.1:5188' });
    assert.equal(result.code, 503);
    assert.ok(!result.body.includes('/nonexistent'));
  } finally {
    if (before === undefined) delete process.env.OFFICE_PRESENCE_CONFIG;
    else process.env.OFFICE_PRESENCE_CONFIG = before;
  }
});
