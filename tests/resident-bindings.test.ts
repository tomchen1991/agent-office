import test from 'node:test';
import assert from 'node:assert/strict';
import { residentSeatReport as liveOfficeSeatReport, validateResidentTopology as validateTopology, parseResidentOfficeConfig as parseOfficeConfig, bindResidentOffice as bindOffice } from '../src/residentLayout.ts';
import type { OfficeAgent } from '../src/core.ts';
import type { ResidentRole } from '../src/residentVisuals.ts';
import type { ResidentOfficeConfig as OfficeConfig } from '../src/residentLayout.ts';
import { sanitizeBridgeState } from '../src/bridgeProtocol.ts';

const roles: ResidentRole[] = ['main', 'auto-fix', 'devops', 'hotspot'];
const config = (): OfficeConfig => ({ version: 1,
  seats: roles.map(id => ({ id, name: id, character: 'chatgpt', selector: { sourceId: 'test', instanceId: id, epoch: { policy: 'follow-unique' } } })),
  office: { selfSeatId: 'main', githubSeatId: 'auto-fix', devopsSeatId: 'devops', hotspotSeatId: 'hotspot', childSeatIds: [], team: { layout: 'independent-desks', memberSeatIds: [] } },
});
const agent = (role: ResidentRole, epoch = 'one'): OfficeAgent => ({ id: `${role}/${epoch}`, name: 'Untrusted display name', character: 'unknown', status: 'working', source: 'test', observedAt: null, latestUserRequest: null, identity: { sourceId: 'test', instanceId: role, collectorEpoch: epoch } });
const snapshot = (agents: OfficeAgent[]) => ({ agents, receivedAt: '2026-11-10T00:00:00Z', identityCoverage: 'complete' as const });

test('four explicit resident identities roundtrip and occupy dedicated desks regardless of artwork', () => {
  const c = config();
  assert.deepEqual(parseOfficeConfig(JSON.parse(JSON.stringify(c))), c);
  const bound = bindOffice(c, snapshot(roles.map(role => agent(role))));
  assert.ok(bound.snapshot.agents.every(a => !Object.hasOwn(a, 'residentRole')), 'renderer never adds role fields to source DTOs');
  assert.ok(bound.snapshot.agents.every(a => a.character === 'chatgpt'));
  const assignments = liveOfficeSeatReport(bound.topology).assignments;
  assert.equal(assignments['main/one'], 'self');
  assert.equal(assignments['auto-fix/one'], 'github-desk');
  assert.equal(assignments['devops/one'], 'devops-desk');
  assert.equal(assignments['hotspot/one'], 'hotspot-desk');
});

test('missing or ambiguous residents reserve furniture without fabricating live agents', () => {
  const vacant = bindOffice(config(), snapshot([]));
  assert.equal(vacant.snapshot.agents.length, 0);
  assert.equal(vacant.warnings.length, 4);
  assert.equal(liveOfficeSeatReport(vacant.topology).assignments[vacant.topology.devopsAgentId!], 'devops-desk');
  assert.equal(liveOfficeSeatReport(vacant.topology).assignments[vacant.topology.hotspotAgentId!], 'hotspot-desk');
  const ambiguous = bindOffice(config(), snapshot([agent('devops'), agent('devops', 'two'), agent('hotspot')]));
  assert.equal(ambiguous.bindings.devops, null);
  assert.equal(ambiguous.warnings.find(w => w.seatId === 'devops')?.code, 'ambiguous');
  assert.equal(ambiguous.topology.hotspotAgentId, 'hotspot/one');
  assert.deepEqual(ambiguous.snapshot.agents.map(a => a.id), ['hotspot/one']);
  const partial = bindOffice(config(), { ...snapshot([agent('devops')]), identityCoverage: 'partial' });
  assert.equal(partial.bindings.devops, null);
});

test('new resident config and topology fields reject empty, duplicate, missing and unknown identities', () => {
  for (const field of ['devopsSeatId', 'hotspotSeatId']) {
    for (const invalid of ['', undefined, null, 'missing', 'main', 'auto-fix']) {
      assert.throws(() => parseOfficeConfig({ ...config(), office: { ...config().office, [field]: invalid } }));
    }
  }
  const topology = bindOffice(config(), snapshot(roles.map(role => agent(role)))).topology;
  for (const field of ['devopsAgentId', 'hotspotAgentId']) {
    for (const invalid of ['', null, 42, topology.selfAgentId, topology.githubAgentId]) {
      assert.throws(() => validateTopology({ ...topology, [field]: invalid }));
    }
  }
  assert.throws(() => parseOfficeConfig({ ...config(), office: { ...config().office, residentProvider: 'openai' } }));
});

test('existing bridge protocol does not adopt renderer-only resident metadata', () => {
  const input = { phase: 'connected', error: null, snapshot: snapshot([{ ...agent('devops'), residentRole: 'devops' } as OfficeAgent]) };
  const clean = sanitizeBridgeState(input);
  assert.equal(clean.phase, 'connected');
  assert.ok(!Object.hasOwn(clean.snapshot!.agents[0], 'residentRole'));
});

test('renderer config preserves core plain-object, accessor and array boundaries', () => {
  for (const target of ['root', 'office', 'team', 'members'] as const) {
    const c = config();
    let reads = 0;
    const object = target === 'root' ? c : target === 'office' ? c.office : target === 'team' ? c.office.team : c.office.team.memberSeatIds;
    const key = target === 'root' ? 'office' : target === 'office' ? 'team' : target === 'team' ? 'memberSeatIds' : '0';
    Object.defineProperty(object, key, { enumerable: true, get() { reads++; return []; } });
    assert.throws(() => parseOfficeConfig(c));
    assert.equal(reads, 0);
  }
  for (const target of ['root', 'office', 'team'] as const) {
    const c = config();
    const object = target === 'root' ? c : target === 'office' ? c.office : c.office.team;
    Object.setPrototypeOf(object, { unexpected: true });
    assert.throws(() => parseOfficeConfig(c), /plain/);
  }
  const extended = config(); Object.assign(extended.office.team.memberSeatIds, { extra: true });
  assert.throws(() => parseOfficeConfig(extended), /list/);
  const symbol = config(); Object.assign(symbol.office.team, { [Symbol('extra')]: true });
  assert.throws(() => parseOfficeConfig(symbol), /Unknown/);
  const sparse = config(); sparse.office.team.memberSeatIds = new Array(1);
  assert.throws(() => parseOfficeConfig(sparse), /list/);
});

test('renderer-only assignments safely support prototype-like instance identifiers', () => {
  const assignments = liveOfficeSeatReport({ selfAgentId: 'owner', childAgentIds: [], devopsAgentId: '__proto__', hotspotAgentId: 'constructor', team: { layout: 'independent-desks', memberIds: [] } }).assignments;
  assert.equal(Object.getPrototypeOf(assignments), null);
  assert.equal(assignments['__proto__'], 'devops-desk');
  assert.equal(assignments.constructor, 'hotspot-desk');
});
