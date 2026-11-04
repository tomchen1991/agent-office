import test from 'node:test';
import assert from 'node:assert/strict';
import type { OfficeAgent } from '../src/core.ts';
import { createPresenceSeatAllocator, presenceTopology, presenceProxy, providerCharacter } from '../server/presenceProxy.ts';

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
