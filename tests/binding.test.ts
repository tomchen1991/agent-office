import test from 'node:test';
import assert from 'node:assert/strict';
import { bindOffice } from '../src/binding.ts';
import { enrichOfficeSnapshot } from '../src/enrichment.ts';
import { validateTopology } from '../src/core.ts';
import type { OfficeAgent, OfficeSnapshot } from '../src/core.ts';
import type { OfficeConfig } from '../src/config.ts';
const agent = (sourceId = 'demo-source', epoch = 'e1', instanceId = 'demo-agent'): OfficeAgent => ({
  id: JSON.stringify([sourceId,instanceId,epoch]), identity: {sourceId,instanceId,collectorEpoch:epoch},
  name:'未配置',character:'unknown',status:'idle',observedAt:null,latestUserRequest:null,source:sourceId,
});
const snapshot = (...agents: OfficeAgent[]): OfficeSnapshot => ({agents,receivedAt:'2026-01-01T00:00:00Z',identityCoverage:'complete'});
const config = (policy: 'exact'|'follow-unique' = 'exact'): OfficeConfig => ({
  version:1,seats:[{id:'owner',name:'自研 Agent',character:'self',selector:{sourceId:'demo-source',instanceId:'demo-agent',epoch:policy === 'exact' ? {policy,value:'e1'} : {policy}}}],
  office:{selfSeatId:'owner',childSeatIds:[],team:{layout:'peer-table',memberSeatIds:[]}},
});
test('exact epoch binds persona only on current exact identity and manual rebind is explicit', () => {
  const old = agent(); const next = agent('demo-source','e2');
  const bound = bindOffice(config(),snapshot(old)); assert.equal(bound.snapshot.agents[0].character,'self');
  const vacant = bindOffice(config(),snapshot(next)); assert.equal(vacant.snapshot.agents.length,0); assert.equal(vacant.bindings.owner,null);
  assert.equal(next.character,'unknown'); assert.equal(next.latestUserRequest,null);
  const updated = config(); updated.seats[0].selector.epoch = {policy:'exact',value:'e2'};
  assert.equal(bindOffice(updated,snapshot(next)).bindings.owner,next.id);
});
test('follow-unique rebinding handles epoch rollover but multiple retained epochs remain unbound', () => {
  const c = config('follow-unique'); const old = agent(); const next = agent('demo-source','e2');
  assert.equal(bindOffice(c,snapshot(next)).bindings.owner,next.id);
  const ambiguous = bindOffice(c,snapshot({...old,status:'offline'},next));
  assert.equal(ambiguous.bindings.owner,null); assert.equal(ambiguous.warnings[0].code,'ambiguous');
  assert.doesNotThrow(()=>validateTopology(ambiguous.topology));
});
test('explicit source protects against same instance and epoch in another source', () => {
  const selected = agent(); const other = agent('other-source');
  const result = bindOffice(config(),snapshot(other,selected));
  assert.equal(result.snapshot.agents.length,1); assert.equal(result.bindings.owner,selected.id);
});
test('missing structured identity is never guessed from persona, role, or id string', () => {
  const noIdentity = {...agent(),identity:undefined,character:'self' as const};
  assert.equal(bindOffice(config(),snapshot(noIdentity)).warnings[0].code,'unmatched');
});
test('duplicate current instance IDs rejected and vacant topology avoids actual ID collisions', () => {
  const a = agent(); assert.throws(()=>bindOffice(config(),snapshot(a,a)),/unique/);
  const collision = {...agent('other'),id:JSON.stringify(['unbound-seat','owner'])};
  const result = bindOffice(config(),snapshot(collision)); assert.notEqual(result.topology.selfAgentId,collision.id);
});
test('enrichment affects exact epoch request only, never state/topology/persona or missing instances', () => {
  const old = agent(); const next = agent('demo-source','e2');
  const request = {agentId:old.id,summary:'请检查演示布局',receivedAt:'2026-01-01T00:00:00Z',source:'host-user-input'};
  const original = snapshot(old); const result = enrichOfficeSnapshot(original,{userRequests:[request]});
  assert.equal(result.snapshot.agents[0].latestUserRequest?.source,'host-user-input');
  assert.equal(original.agents[0].latestUserRequest,null); assert.equal(result.snapshot.agents[0].status,old.status);
  const rolled = enrichOfficeSnapshot(snapshot(next),{userRequests:[request]});
  assert.equal(rolled.snapshot.agents[0].latestUserRequest,null); assert.deepEqual(rolled.unmatchedAgentIds,[old.id]);
});
test('invalid or duplicate enrichment rejected', () => {
  const request = {agentId:agent().id,summary:'demo',receivedAt:'2026-01-01',source:'fixture'};
  assert.throws(()=>enrichOfficeSnapshot(snapshot(agent()),{userRequests:[request,request]}),/Duplicate/);
  assert.throws(()=>enrichOfficeSnapshot(snapshot(agent()),{userRequests:[{...request,summary:' '}]}),/Invalid/);
  assert.throws(()=>enrichOfficeSnapshot(snapshot(agent()),{userRequests:[{...request,receivedAt:'invalid'}]}),/Invalid/);
});

test('follow-unique never claims global uniqueness from partial or unknown identity coverage', () => {
  for (const identityCoverage of ['partial', 'unknown', undefined] as const) {
    const partial = {...snapshot(agent()),identityCoverage};
    assert.equal(bindOffice(config('follow-unique'),partial).warnings[0].code,'incomplete');
    assert.equal(bindOffice(config('follow-unique'),partial).bindings.owner,null);
    assert.equal(bindOffice(config('exact'),partial).bindings.owner,agent().id);
  }
});
test('older enrichment cannot overwrite latest request, equal-time host correction is explicit', () => {
  const current = {...agent(),latestUserRequest:{summary:'new',receivedAt:'2026-02-01T00:00:00Z',source:'host'}};
  const older = {agentId:current.id,summary:'old',receivedAt:'2026-01-01T00:00:00Z',source:'host'};
  const result = enrichOfficeSnapshot(snapshot(current),{userRequests:[older]});
  assert.equal(result.snapshot.agents[0].latestUserRequest?.summary,'new');
  assert.deepEqual(result.ignoredOlderAgentIds,[current.id]);
  const corrected = enrichOfficeSnapshot(snapshot(current),{userRequests:[{...older,summary:'corrected',receivedAt:current.latestUserRequest.receivedAt}]});
  assert.equal(corrected.snapshot.agents[0].latestUserRequest?.summary,'corrected');
});

test('filtered binding output cannot claim complete identity coverage to a subsequent binder', () => {
  const complete = snapshot(agent(),agent('demo-source','e2'));
  const selected = bindOffice(config('exact'),complete);
  assert.equal(selected.snapshot.identityCoverage,'partial');
  const rebound = bindOffice(config('follow-unique'),selected.snapshot);
  assert.equal(rebound.bindings.owner,null); assert.equal(rebound.warnings[0].code,'incomplete');
});
