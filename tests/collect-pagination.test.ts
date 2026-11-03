import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectAdapter, normalizeStatus } from '../server/collect.ts';
import type { CollectOptions } from '../server/collect.ts';
import { bindOffice } from '../src/binding.ts';
import { parseOfficeConfig } from '../src/config.ts';
import type { AdapterState } from '../src/core.ts';

const at = '2026-11-03T00:00:00.000Z';
const instance = (id: string, extra: Record<string, unknown> = {}) => ({ sourceId: 'source', instanceId: id, collectorEpoch: 'epoch', wireVersion: 2, connection: 'connected', freshness: 'fresh', status: 'active', snapshotReceivedAt: at, staleAfterMs: 15000, ...extra });
const page = (instances: unknown[], nextOffset: number | null, extra: Record<string, unknown> = {}) => ({ version: 1, scope: 'pi-v1', persistence: 'memory', storageReady: true, processId: 'process', startedAt: at, observedAt: at, coverage: { omitted: false }, total: 64, instances, nextOffset, ...extra });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const flush = async () => { for (let index = 0; index < 1000; index++) await Promise.resolve(); };
function harness(fetcher: typeof fetch, extra: Partial<CollectOptions> = {}) {
  let id = 0;
  const jobs = new Map<number, { callback: () => void; ms: number }>();
  const states: AdapterState[] = [];
  const adapter = createCollectAdapter({ baseURL: 'http://127.0.0.1:8000', token: () => 'test-only-token', fetch: fetcher, now: () => Date.parse(at), monotonicNow: () => 0,
    setTimer(callback, ms) { const key = ++id; jobs.set(key, { callback, ms }); return key as unknown as ReturnType<typeof setTimeout>; },
    clearTimer(timer) { jobs.delete(timer as unknown as number); }, ...extra,
  });
  adapter.subscribe(state => states.push(state));
  return { adapter, states, jobs, fire(ms: number) { const match = [...jobs].find(([, job]) => job.ms === ms); assert.ok(match, `missing timer ${ms}`); jobs.delete(match[0]); match[1].callback(); } };
}
const snapshot = (h: ReturnType<typeof harness>) => { assert.equal(h.states.at(-1)!.phase, 'connected'); return h.states.at(-1)!.snapshot!; };

test('walks all 41 bounded pages sequentially and publishes only the completed non-atomic collection', async () => {
  const offsets: number[] = [];
  const sourceId = 'source & offset=999';
  let inFlight = 0;
  const h = harness(async (input, init) => {
    assert.equal(++inFlight, 1);
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v1/status');
    assert.equal(url.searchParams.get('limit'), '32');
    assert.equal(url.searchParams.get('sourceId'), sourceId);
    assert.deepEqual([...url.searchParams.keys()].sort(), offsets.length === 0 ? ['limit', 'sourceId'] : ['limit', 'offset', 'sourceId']);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Origin'), null); assert.equal(headers.get('Authorization'), 'Bearer test-only-token');
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    const offset = Number(url.searchParams.get('offset') ?? 0);
    offsets.push(offset);
    assert.ok(offset <= 1280);
    assert.equal(h.states.filter(state => state.phase === 'connected').length, 0);
    await Promise.resolve(); inFlight--;
    return response(page(Array.from({ length: 32 }, (_, index) => instance(String(offset + index))), offset === 1280 ? null : offset + 32, { total: 1312 }));
  }, { sourceId });
  h.adapter.connect(); h.adapter.connect(); await flush();
  const result = snapshot(h);
  assert.equal(offsets.length, 41); assert.deepEqual(offsets, Array.from({ length: 41 }, (_, index) => index * 32));
  assert.equal(result.agents.length, 1312); assert.equal(result.identityCoverage, 'partial');
  assert.match(result.coverage!, /已读取 41 页，去重后 1312 个实例/); assert.match(result.coverage!, /非原子分页/);
  assert.equal(h.states.filter(state => state.phase === 'connected').length, 1);
  assert.equal(h.jobs.size, 1); h.adapter.dispose();
});

test('deduplicates only the complete identity, preserving the latest page observation and distinct epochs', async () => {
  let calls = 0;
  const h = harness(async () => response(++calls === 1
    ? page([instance('same'), instance('same', { status: 'idle' })], 32, { total: 3 })
    : page([instance('same', { status: 'stopping' }), instance('same', { collectorEpoch: 'new-epoch' })], null, { total: 3 })));
  h.adapter.connect(); await flush();
  const result = snapshot(h);
  assert.equal(result.agents.length, 2); assert.equal(result.agents[0].status, 'stopping');
  assert.notEqual(result.agents[0].id, result.agents[1].id);
  assert.equal(result.identityCoverage, 'partial'); assert.match(result.coverage!, /去重后 2 个实例/);
  h.adapter.dispose();
});

test('multi-page observations never enable follow-unique rebinding, even with matching totals', async () => {
  let calls = 0;
  const h = harness(async () => response(++calls === 1 ? page([instance('same')], 32, { total: 2 }) : page([instance('other')], null, { total: 2 })));
  h.adapter.connect(); await flush();
  const result = snapshot(h);
  const config = parseOfficeConfig({ version: 1, seats: [{ id: 'self-seat', name: 'Self', character: 'self', selector: { sourceId: 'source', instanceId: 'same', epoch: { policy: 'follow-unique' } } }], office: { selfSeatId: 'self-seat', childSeatIds: [], team: { layout: 'peer-table', memberSeatIds: [] } } });
  const bound = bindOffice(config, result);
  assert.equal(bound.bindings['self-seat'], null); assert.equal(bound.warnings[0].code, 'incomplete');
  h.adapter.dispose();
});

test('a process restart discards the whole candidate and retry begins at the first page', async () => {
  const offsets: number[] = [];
  let calls = 0;
  const h = harness(async input => {
    offsets.push(Number(new URL(String(input)).searchParams.get('offset') ?? 0));
    calls++;
    return response(calls === 1 ? page([instance('discard-old')], 32)
      : calls === 2 ? page([instance('discard-restart')], null, { processId: 'new-process' })
      : page([instance(calls === 3 ? 'new-a' : 'new-b')], calls === 3 ? 32 : null, { processId: 'new-process', total: 2 }));
  });
  h.adapter.connect(); await flush();
  assert.equal(h.states.at(-1)!.phase, 'disconnected'); assert.equal(h.states.at(-1)!.snapshot, null);
  h.fire(10000); await flush();
  const result = snapshot(h);
  assert.deepEqual(offsets, [0, 32, 0, 32]);
  assert.deepEqual(result.agents.map(agent => agent.identity!.instanceId), ['new-a', 'new-b']);
  assert.doesNotMatch(JSON.stringify(h.states), /discard-old|discard-restart/);
  h.adapter.dispose();
});

test('same-process server observation regression or changed process start discards the walk', async () => {
  for (const changes of [{ observedAt: '2026-11-02T23:59:59.000Z' }, { startedAt: '2026-11-02T23:59:59.000Z' }]) {
    let calls = 0;
    const h = harness(async () => response(++calls === 1 ? page([instance('a')], 32) : page([instance('b')], null, changes)));
    h.adapter.connect(); await flush();
    assert.equal(calls, 2); assert.equal(h.states.at(-1)!.phase, 'disconnected'); assert.equal(h.states.at(-1)!.snapshot, null);
    h.adapter.dispose();
  }
});

test('cursor validation rejects malformed, out-of-range, repeated and regressing offsets', async () => {
  for (const nextOffset of [-1, 0, 1.5, '32', 1281, {}, undefined]) {
    let calls = 0;
    const h = harness(async () => { calls++; return response({ ...page([instance('a')], null), nextOffset }); });
    h.adapter.connect(); await flush();
    assert.equal(calls, 1); assert.equal(h.states.at(-1)!.phase, 'disconnected'); assert.equal(h.states.at(-1)!.snapshot, null); h.adapter.dispose();
  }
  for (const nextOffset of [16, 32]) {
    let calls = 0;
    const h = harness(async () => response(page([instance(String(++calls))], calls === 1 ? 32 : nextOffset)));
    h.adapter.connect(); await flush(); assert.equal(calls, 2); assert.equal(h.states.at(-1)!.phase, 'disconnected'); h.adapter.dispose();
  }
  for (const nextOffset of [Infinity, NaN]) assert.throws(() => normalizeStatus({ ...page([], null), nextOffset }, {}, 0));
});

test('a maliciously slow-advancing cursor cannot cause more than 41 page requests', async () => {
  let calls = 0;
  const h = harness(async () => response(page([instance(String(calls))], ++calls)));
  h.adapter.connect(); await flush(); assert.equal(calls, 41);
  assert.equal(h.states.at(-1)!.phase, 'disconnected'); assert.equal(h.states.at(-1)!.snapshot, null);
  h.adapter.dispose();
});

test('the last allowed offset is accepted, but a next offset above the bound is never requested', async () => {
  const offsets: number[] = [];
  const h = harness(async input => {
    const offset = Number(new URL(String(input)).searchParams.get('offset') ?? 0); offsets.push(offset);
    return response(page([instance(String(offset))], offset === 0 ? 1280 : 1312));
  });
  h.adapter.connect(); await flush(); assert.deepEqual(offsets, [0, 1280]);
  assert.equal(h.states.at(-1)!.phase, 'disconnected'); h.adapter.dispose();
});

test('later-page 401/403 stop until reconnect; 429/503 discard and retry from zero', async () => {
  for (const status of [401, 403, 429, 503]) {
    const offsets: number[] = [];
    let calls = 0;
    const h = harness(async input => {
      offsets.push(Number(new URL(String(input)).searchParams.get('offset') ?? 0)); calls++;
      return calls === 2 ? response({ secret: 'private-response-secret' }, status) : response(page([instance('a')], calls === 1 ? 32 : null, { total: 1 }));
    });
    h.adapter.connect(); await flush();
    assert.equal(h.states.at(-1)!.phase, 'disconnected'); assert.equal(h.states.at(-1)!.snapshot, null);
    assert.doesNotMatch(JSON.stringify(h.states), /test-only-token|private-response-secret|127\.0\.0\.1/);
    if (status === 401 || status === 403) { assert.equal(h.jobs.size, 0); h.adapter.connect(); }
    else h.fire(10000);
    await flush(); snapshot(h); assert.deepEqual(offsets, [0, 32, 0]); h.adapter.dispose();
  }
});

test('malformed or failed later page cannot replace a previous snapshot or mark absences offline', async () => {
  for (const failure of ['transport', 'json', 'contract', 'oversize']) {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      if (calls === 1) return response(page([instance('previous')], null, { total: 1 }));
      if (calls === 2) return response(page([instance('candidate')], 32));
      if (failure === 'transport') throw new Error('private-token-and-url');
      if (failure === 'json') return new Response('private invalid json');
      if (failure === 'oversize') return new Response('x'.repeat(1_048_577));
      return response({ secret: 'private invalid contract' });
    });
    h.adapter.connect(); await flush(); snapshot(h); h.fire(5000); await flush();
    const state = h.states.at(-1)!;
    assert.equal(state.phase, 'disconnected'); assert.equal(state.snapshot!.identityCoverage, 'unknown');
    assert.equal(state.snapshot!.agents.length, 1); assert.equal(state.snapshot!.agents[0].identity!.instanceId, 'previous');
    assert.equal(state.snapshot!.agents[0].status, 'unknown');
    assert.doesNotMatch(JSON.stringify(h.states), /candidate|private-token|private invalid/); h.adapter.dispose();
  }
});

test('dispose aborts a later page, prevents further pages and ignores late completion after reconnect', async () => {
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  let finish!: (response: Response) => void;
  let lateBodyCanceled = false;
  const h = harness(async (_, init) => {
    calls++;
    if (calls === 1) return response(page([instance('old-a')], 32));
    if (calls === 2) { signal = init?.signal; return new Promise<Response>(resolve => { finish = resolve; }); }
    return response(page([instance('current')], null, { total: 1 }));
  });
  h.adapter.connect(); await flush(); assert.equal(calls, 2); h.adapter.dispose();
  assert.equal(signal?.aborted, true); assert.equal(h.jobs.size, 0);
  h.adapter.connect(); await flush();
  finish(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(page([instance('old-b')], 64)))); }, cancel() { lateBodyCanceled = true; } })));
  await flush(); assert.equal(lateBodyCanceled, true);
  assert.equal(calls, 3); assert.equal(snapshot(h).agents[0].identity!.instanceId, 'current');
  assert.doesNotMatch(JSON.stringify(h.states), /old-a|old-b/); h.adapter.dispose();
});

test('one timeout bounds the entire walk and a stalled response body is canceled', async () => {
  let calls = 0;
  let canceled = false;
  let signal: AbortSignal | null | undefined;
  const h = harness(async (_, init) => {
    calls++; signal = init?.signal;
    if (calls === 1) return response(page([instance('a')], 32));
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { canceled = true; } }));
  }, { timeoutMs: 12345 });
  h.adapter.connect(); await flush(); assert.equal(calls, 2);
  assert.deepEqual([...h.jobs.values()].map(job => job.ms), [12345]);
  h.fire(12345); await flush();
  assert.equal(signal?.aborted, true); assert.equal(canceled, true);
  assert.equal(h.states.at(-1)!.snapshot, null); assert.match(h.states.at(-1)!.error!, /超时/);
  assert.deepEqual([...h.jobs.values()].map(job => job.ms), [10000]); h.adapter.dispose();
});

test('early-page freshness ages only by local monotonic walk duration, not source or client wall time', async () => {
  let elapsed = 0;
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 2) elapsed = 200;
    return response(page([instance(calls === 1 ? 'early' : 'late', { staleAfterMs: 100, snapshotReceivedAt: '1990-01-01T00:00:00.000Z' })], calls === 1 ? 32 : null, { total: 2 }));
  }, { monotonicNow: () => elapsed, now: () => 0 });
  h.adapter.connect(); await flush(); const result = snapshot(h);
  assert.equal(result.receivedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(result.agents[0].sourceFreshness, 'stale'); assert.equal(result.agents[0].status, 'unknown');
  assert.equal(result.agents[1].sourceFreshness, 'fresh'); assert.equal(result.agents[1].status, 'working');
  h.adapter.dispose();
});

test('early-page freshness loses elapsed time and duplicates restart only from their latest page observation', async () => {
  let elapsed = 0;
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 2) elapsed = 200;
    return response(page(calls === 1 ? [instance('early'), instance('duplicate')] : [instance('duplicate')], calls === 1 ? 32 : null, { total: 2 }));
  }, { monotonicNow: () => elapsed });
  h.adapter.connect(); await flush(); const agents = snapshot(h).agents;
  assert.equal(agents[0].validForMs, 14800); assert.equal(agents[1].validForMs, 15000); h.adapter.dispose();
});

test('coverage combines omissions/readiness and explicitly reports totals that shift during the walk', async () => {
  let calls = 0;
  const h = harness(async () => response(++calls === 1
    ? page([instance('a')], 32, { coverage: { omitted: true }, storageReady: false, total: 9 })
    : page([instance('b')], null, { total: 2 })));
  h.adapter.connect(); await flush(); const result = snapshot(h);
  assert.equal(result.identityCoverage, 'partial'); assert.match(result.coverage!, /服务报告总数 2/);
  assert.match(result.coverage!, /总数发生变化/); assert.match(result.coverage!, /存储未就绪/); assert.match(result.coverage!, /存在遗漏/);
  assert.match(result.coverage!, /缺席不代表已退出/); h.adapter.dispose();
});

test('single page remains complete only with fully accounted identities, ready storage and no omissions', () => {
  assert.equal(normalizeStatus(page([], null, { total: 0 }), {}, 0).identityCoverage, 'complete');
  for (const changes of [{ storageReady: false }, { coverage: { omitted: true } }, { total: 3 }]) {
    assert.equal(normalizeStatus(page([instance('a')], null, { total: 1, ...changes }), {}, 0).identityCoverage, 'partial');
  }
  assert.throws(() => normalizeStatus(page([instance('a'), instance('a', { staleAfterMs: 0 })], null), {}, 0));
  for (const changes of [{ startedAt: null }, { processId: '' }, { observedAt: 'invalid' }, { total: -1 }]) assert.throws(() => normalizeStatus(page([], null, changes), {}, 0));
});


test('fractional elapsed time is rounded conservatively to positive integer windows for IPC', async () => {
  let calls = 0;
  let elapsed = 0;
  const h = harness(async () => {
    if (++calls === 2) elapsed = 0.75;
    return response(page([instance(calls === 1 ? 'early' : 'late', { staleAfterMs: 1 })], calls === 1 ? 32 : null, { total: 2 }));
  }, { monotonicNow: () => elapsed });
  h.adapter.connect(); await flush();
  const agents = snapshot(h).agents;
  assert.equal(agents[0].sourceFreshness, 'stale'); assert.equal(agents[0].status, 'unknown');
  for (const agent of agents) { assert.equal(Number.isSafeInteger(agent.validForMs), true); assert.ok(agent.validForMs! > 0); }
  h.adapter.dispose();
});
