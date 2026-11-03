import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectAdapter, normalizeStatus } from '../server/collect.ts';
import type { AdapterState } from '../src/core.ts';
const at = '2026-11-03T00:00:00.000Z';
const instance = { sourceId: 'source', instanceId: 'agent', collectorEpoch: 'epoch', wireVersion: 2, connection: 'connected', freshness: 'fresh', status: 'active', snapshotReceivedAt: at, staleAfterMs: 15000 };
const payload = (instances: unknown[] = [instance]) => ({ version: 1, scope: 'pi-v1', persistence: 'memory', storageReady: true, processId: 'process', startedAt: at, observedAt: at, coverage: { omitted: false }, total: instances.length, instances, nextOffset: null });
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function harness(fetcher: typeof fetch) {
  let id = 0;
  const jobs = new Map<number, { callback: () => void; ms: number }>();
  const states: AdapterState[] = [];
  const adapter = createCollectAdapter({ baseURL: 'http://127.0.0.1:8000', token: () => 'test-only-token', fetch: fetcher, now: () => Date.parse(at),
    setTimer(callback, ms) { const key = ++id; jobs.set(key, { callback, ms }); return key as unknown as ReturnType<typeof setTimeout>; },
    clearTimer(timer) { jobs.delete(timer as unknown as number); },
  });
  adapter.subscribe(state => states.push(state));
  return { adapter, states, jobs, fire(ms: number) { const match = [...jobs].find(([, job]) => job.ms === ms); assert.ok(match, `missing timer ${ms}`); jobs.delete(match[0]); match[1].callback(); } };
}
const response = (body: unknown = payload(), status = 200) => new Response(JSON.stringify(body), { status });
test('status normalization does not invent model, task or topology; collision-safe identity', () => {
  const snapshot = normalizeStatus(payload(), {}, Date.parse(at));
  assert.equal(snapshot.agents[0].id, JSON.stringify(['source', 'agent', 'epoch']));
  assert.equal(snapshot.agents[0].character, 'unknown');
  assert.equal(snapshot.agents[0].latestUserRequest, null);
  assert.equal(snapshot.agents[0].status, 'working');
  assert.match(snapshot.coverage!, /已读取 1 页/); assert.equal(snapshot.identityCoverage, 'complete');
});
test('stale and disconnected observations never retain current active work', () => {
  assert.equal(normalizeStatus(payload([{ ...instance, freshness: 'stale' }]), {}, 0).agents[0].status, 'unknown');
  const offline = normalizeStatus(payload([{ ...instance, connection: 'disconnected' }]), {}, 0).agents[0];
  assert.equal(offline.status, 'offline'); assert.equal(offline.observedAt, null);
  assert.equal(normalizeStatus(payload([{ ...instance, status: 'stopping' }]), {}, 0).agents[0].status, 'stopping');
});
test('explicit identity mapping, dedupe, page coverage and validation', () => {
  const result = normalizeStatus({ ...payload([instance, instance]), total: 40, nextOffset: 32, coverage: { omitted: true } }, { identity: () => ({ name: 'Configured', character: 'self' }) }, 0);
  assert.equal(result.identityCoverage, 'partial'); assert.equal(result.agents.length, 1); assert.equal(result.agents[0].character, 'self'); assert.match(result.coverage!, /后续分页/);
  assert.throws(() => normalizeStatus({ ...payload(), version: 2 }, {}, 0));
  assert.throws(() => normalizeStatus({ ...payload(), coverage: { omitted: 2 } }, {}, 0));
  assert.throws(() => normalizeStatus(payload([{ ...instance, status: 'invented' }]), {}, 0));
  assert.throws(() => normalizeStatus(payload(Array(33).fill(instance)), {}, 0));
});
test('Node fetch excludes Origin, uses auth and forbids redirects; repeated connect does not overlap', async () => {
  let calls = 0;
  const h = harness(async (input, options) => { calls++; assert.match(String(input), /\/v1\/status\?limit=32$/); const headers = new Headers(options?.headers); assert.equal(headers.get('Origin'), null); assert.equal(headers.get('Authorization'), 'Bearer test-only-token'); assert.equal(options?.redirect, 'error'); return response(); });
  h.adapter.connect(); h.adapter.connect(); await flush();
  assert.equal(calls, 1); assert.equal(h.states.at(-1)?.phase, 'connected');
  h.fire(5000); await flush(); assert.equal(calls, 2); h.adapter.dispose(); assert.equal(h.jobs.size, 0); assert.equal(h.states.at(-1)!.snapshot!.agents[0].sourceFreshness, 'unknown');
});
test('401/403 are terminal until explicit reconnect, and errors are sanitized', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const h = harness(async () => { calls++; return response({ secret: 'private-server-body' }, status); });
    h.adapter.connect(); await flush(); assert.equal(h.jobs.size, 0); assert.match(h.states.at(-1)!.error!, /授权失败/);
    assert.doesNotMatch(JSON.stringify(h.states), /test-only-token|private-server-body|127\.0\.0\.1/);
    h.adapter.connect(); await flush(); assert.equal(calls, 2); h.adapter.dispose();
  }
});
test('429/503 retry with bounded backoff then recover', async () => {
  let calls = 0;
  const h = harness(async () => ++calls === 1 ? response({}, 429) : calls === 2 ? response({}, 503) : response());
  h.adapter.connect(); await flush(); h.fire(10000); await flush(); h.fire(20000); await flush();
  assert.equal(h.states.at(-1)?.phase, 'connected'); assert.ok([...h.jobs.values()].some(job => job.ms === 5000)); h.adapter.dispose();
});
test('dispose cancels outstanding request and ignores late completion after reconnect', async () => {
  let resolve!: (value: Response) => void;
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  const h = harness(async (_, options) => { calls++; if (calls === 1) { signal = options?.signal; return new Promise<Response>(r => { resolve = r; }); } return response(payload([{ ...instance, instanceId: 'new' }])); });
  h.adapter.connect(); await flush(); h.adapter.dispose(); assert.equal(signal?.aborted, true);
  h.adapter.connect(); await flush(); resolve(response()); await flush();
  assert.match(h.states.at(-1)!.snapshot!.agents[0].id, /new/); h.adapter.dispose(); assert.equal(h.jobs.size, 0);
});
test('timeout recovers even if injected fetch ignores abort; unsubscribe stops notifications', async () => {
  const h = harness(async () => new Promise<Response>(() => {}));
  let notifications = 0; const unsubscribe = h.adapter.subscribe(() => notifications++); unsubscribe();
  h.adapter.connect(); await flush(); h.fire(10000); await flush();
  assert.equal(h.states.at(-1)?.phase, 'disconnected'); assert.match(h.states.at(-1)!.error!, /超时/); assert.equal(notifications, 1);
  h.adapter.dispose(); assert.equal(h.jobs.size, 0);
});
test('transport failure removes stale current status and never exposes thrown secrets', async () => {
  let calls = 0;
  const h = harness(async () => { if (++calls === 1) return response(); throw new Error('token=secret and internal URL'); });
  h.adapter.connect(); await flush(); h.fire(5000); await flush();
  assert.equal(h.states.at(-1)!.snapshot!.identityCoverage, 'unknown'); assert.equal(h.states.at(-1)!.snapshot!.agents[0].status, 'unknown'); assert.equal(h.states.at(-1)!.snapshot!.agents[0].observedAt, null); assert.equal(h.states.at(-1)!.snapshot!.agents[0].sourceFreshness, 'unknown');
  assert.doesNotMatch(JSON.stringify(h.states), /token=secret/); h.adapter.dispose();
});
test('malformed response retries; restart replaces previous current instances', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    if (calls === 1) return response(payload());
    if (calls === 2) return response({ private: 'not a valid status' });
    return response({ ...payload([{ ...instance, collectorEpoch: 'new-epoch' }]), processId: 'new-process' });
  });
  h.adapter.connect(); await flush(); h.fire(5000); await flush(); assert.equal(h.states.at(-1)?.phase, 'disconnected');
  h.fire(10000); await flush(); const agents = h.states.at(-1)!.snapshot!.agents; assert.equal(agents.length, 1); assert.match(agents[0].id, /new-epoch/); h.adapter.dispose();
});
test('identity tuple does not collide for delimiter-containing components', () => {
  const result = normalizeStatus(payload([{ ...instance, sourceId: 'a:b', instanceId: 'c' }, { ...instance, sourceId: 'a', instanceId: 'b:c' }]), {}, 0);
  assert.equal(result.agents.length, 2); assert.notEqual(result.agents[0].id, result.agents[1].id);
});
test('remote cleartext, embedded credentials and URL query are rejected before fetching', () => {
  for (const baseURL of ['http://collector.example', 'https://user:secret@collector.example', 'https://collector.example?token=secret', 'https://collector.example#secret']) {
    assert.throws(() => createCollectAdapter({ baseURL, token: () => 'not-used' }));
  }
});
test('retry backoff is capped and no retry remains after dispose', async () => {
  const h = harness(async () => response({}, 503));
  h.adapter.connect(); await flush();
  for (const delay of [10000, 20000, 40000, 60000, 60000]) { h.fire(delay); await flush(); }
  assert.equal(h.jobs.size, 1); assert.equal([...h.jobs.values()][0].ms, 60000);
  h.adapter.dispose(); assert.equal(h.jobs.size, 0);
});
test('pending token acquisition can be canceled before any network request', async () => {
  let release!: (token: string) => void;
  let calls = 0;
  const adapter = createCollectAdapter({ baseURL: 'https://collector.example', token: () => new Promise<string>(resolve => { release = resolve; }), fetch: async () => { calls++; return response(); } });
  adapter.connect(); adapter.dispose(); release('not-real-token'); await flush(); assert.equal(calls, 0);
});

test('server freshness and stale threshold are preserved independently of an old snapshot time', () => {
  const agent = normalizeStatus(payload([{ ...instance, snapshotReceivedAt: '2020-01-01T00:00:00.000Z' }]), {}, Date.parse(at)).agents[0];
  assert.equal(agent.sourceFreshness, 'fresh'); assert.equal(agent.validForMs, 15000); assert.equal(agent.observedAt, '2020-01-01T00:00:00.000Z');
  for (const staleAfterMs of [null, -1, 0, NaN, '15000']) assert.throws(() => normalizeStatus(payload([{ ...instance, staleAfterMs }]), {}, 0));
});
test('oversized status body is bounded and rejected without exposing content', async () => {
  const h = harness(async () => new Response('x'.repeat(1_048_577)));
  h.adapter.connect(); await flush(); assert.equal(h.states.at(-1)?.phase, 'disconnected');
  assert.equal(h.states.at(-1)?.error, '采集数据不可用，正在重试。'); h.adapter.dispose();
});
