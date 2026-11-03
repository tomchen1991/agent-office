import { MAX_VISIBLE_CHILD_AGENTS as exportedChildCapacity } from '../src/index.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { liveOfficeSeatReport, validateTopology } from '../src/core.ts';
import type { OfficeTopology } from '../src/core.ts';
import { liveOfficeSeats } from '../src/liveOfficeSeats.ts';
import { parseOfficeConfig, exportOfficeConfig, importOfficeConfig } from '../src/config.ts';
import type { OfficeConfig } from '../src/config.ts';
import { bindOffice } from '../src/binding.ts';
const topology = (members = 16): OfficeTopology => ({selfAgentId:'owner',childAgentIds:['child1','child2','child3','child4'],team:{layout:'independent-desks',memberIds:Array.from({length:members},(_,i)=>`member${i+1}`)}});
const config = (): OfficeConfig => ({version:1,seats:['owner','a','b'].map(id=>({id,name:id,character:'unknown',selector:{sourceId:'fixture',instanceId:id,epoch:{policy:'exact',value:'e1'}}})),office:{selfSeatId:'owner',childSeatIds:[],team:{layout:'independent-desks',memberSeatIds:['a','b'],seatAssignments:{a:'public-table-2-seat-3',b:'public-desk-10'}}}});

test('fixed furniture includes 1 owner, 2 private, 10 desks, 1 GitHub desk and 6 public table seats simultaneously',()=>{
 const seats=liveOfficeSeats({selfAgentId:'owner',childAgentIds:[],team:{layout:'peer-table',memberIds:[]}},[]);
 assert.equal(seats.length,20); assert.equal(seats.filter(s=>s.empty).length,19);
 assert.equal(seats.filter(s=>s.geometryId?.startsWith('public-desk-')).length,10);
 assert.equal(seats.filter(s=>s.geometryId?.startsWith('public-table-')).length,6);
 assert.equal(new Set(seats.map(s=>s.geometryId)).size,20);
 assert.equal(seats[0].persona,'unknown'); assert.equal(seats[0].id,'owner');
 assert.ok(seats.every(s=>!Object.hasOwn(s,'status')));
});
test('capacity reserves missing configured identities, reports every overflow, retains stable order',()=>{
 const t=topology(22), report=liveOfficeSeatReport(t);
 assert.deepEqual(report.childOverflowIds,['child3','child4']); assert.deepEqual(report.teamOverflowIds,['member17','member18','member19','member20','member21','member22']);
 assert.equal(report.assignments.member1,'public-desk-1'); assert.equal(report.assignments.member11,'public-table-1-seat-1');
 assert.equal(Object.keys(report.assignments).length,19);
 const seats=liveOfficeSeats(t,[]); assert.equal(seats.length,20);assert.ok(seats.filter(s=>s.kind!=='github').every(s=>!s.empty && s.persona==='unknown'));
});
test('explicit groups reserve positions before defaults and can change without altering actor identity',()=>{
 const t=topology(16); t.team.seatAssignments={member16:'public-desk-1',member3:'public-table-1-seat-1',member4:'public-table-2-seat-2',member5:'public-table-2-seat-3'};
 const a=liveOfficeSeatReport(t);assert.equal(a.assignments.member1,'public-desk-2');assert.equal(a.assignments.member16,'public-desk-1');assert.equal(a.teamOverflowIds.length,0);
 t.team.seatAssignments={member16:'public-table-2-seat-1'};const b=liveOfficeSeatReport(t);assert.equal(b.assignments.member16,'public-table-2-seat-1');assert.equal(b.assignments.member1,'public-desk-1');
});
test('strict assignment validation rejects private positions, unknown members, duplicate slots, fields and accessors',()=>{
 const c=config();
 for(const assignments of [{owner:'public-desk-1'},{missing:'public-desk-1'},{a:'self'},{a:'self-child-1'},{a:'public-desk-11'},{a:'public-table-4-seat-1'},{a:'public-desk-1',b:'public-desk-1'},null,[],{a:'https://example.invalid'}]) {
  assert.throws(()=>parseOfficeConfig({...c,office:{...c.office,team:{...c.office.team,seatAssignments:assignments}}}));
 }
 let invoked=false; const accessor=Object.defineProperty({},'a',{enumerable:true,get(){invoked=true;return 'public-desk-1';}});
 assert.throws(()=>parseOfficeConfig({...c,office:{...c.office,team:{...c.office.team,seatAssignments:accessor}}}));assert.equal(invoked,false);
 assert.throws(()=>validateTopology({...topology(),team:{layout:'peer-table',memberIds:['a'],seatAssignments:{[Symbol('secret')]:'public-desk-1'}}}));
 const extended={...c.office.team.seatAssignments,[Symbol('secret')]:'x'};assert.throws(()=>parseOfficeConfig({...c,office:{...c.office,team:{...c.office.team,seatAssignments:extended}}}));
});
test('config roundtrip copies positions and binder carries logical placement to exact live identities',()=>{
 const c=config(), parsed=importOfficeConfig(exportOfficeConfig(c));assert.deepEqual(parsed,c);assert.notEqual(parsed.office.team.seatAssignments,c.office.team.seatAssignments);
 const agents=['owner','a'].map(instanceId=>({id:`live-${instanceId}`,name:'raw',character:'unknown' as const,status:'idle' as const,source:'fixture',observedAt:null,latestUserRequest:null,identity:{sourceId:'fixture',instanceId,collectorEpoch:'e1'}}));
 const bound=bindOffice(c,{agents,receivedAt:'2026-01-01T00:00:00Z',identityCoverage:'complete'});
 assert.equal(bound.topology.team.seatAssignments?.['live-a'],'public-table-2-seat-3');
 assert.equal(bound.snapshot.agents.length,2);assert.equal(bound.bindings.b,null);
 const report=liveOfficeSeatReport(bound.topology);assert.equal(report.assignments['live-a'],'public-table-2-seat-3');assert.equal(report.assignments[bound.topology.team.memberIds[1]],'public-desk-10');
});
test('empty furniture display keys never collide with actual or configured agent IDs',()=>{
 const id=JSON.stringify(['empty-office-seat','public-desk-1']);
 const t:OfficeTopology={selfAgentId:id,childAgentIds:[],team:{layout:'independent-desks',memberIds:[]}};
 const seats=liveOfficeSeats(t,[]);assert.equal(new Set(seats.map(s=>s.id)).size,20);assert.equal(seats.find(s=>s.geometryId==='self')?.id,id);
});

test('three configured logical children survive config roundtrip and exact binding with third in overflow',()=>{
 const ids=['owner','child1','child2','child3'];
 const c:OfficeConfig={version:1,seats:ids.map(id=>({id,name:id,character:'self',selector:{sourceId:'fixture',instanceId:id,epoch:{policy:'exact',value:'e1'}}})),office:{selfSeatId:'owner',childSeatIds:ids.slice(1),team:{layout:'independent-desks',memberSeatIds:[]}}};
 const parsed=importOfficeConfig(exportOfficeConfig(c));assert.deepEqual(parsed.office.childSeatIds,ids.slice(1));
 const agents=ids.map(instanceId=>({id:`live-${instanceId}`,name:instanceId,character:'self' as const,status:'idle' as const,source:'fixture',observedAt:null,latestUserRequest:null,identity:{sourceId:'fixture',instanceId,collectorEpoch:'e1'}}));
 const bound=bindOffice(parsed,{agents,receivedAt:'2026-01-01T00:00:00Z',identityCoverage:'complete'});
 assert.equal(bound.snapshot.agents.length,4);assert.deepEqual(bound.topology.childAgentIds,['live-child1','live-child2','live-child3']);
 const report=liveOfficeSeatReport(bound.topology);
 assert.equal(report.assignments['live-child1'],'self-child-1');assert.equal(report.assignments['live-child2'],'self-child-2');
 assert.equal(report.assignments['live-child3'],undefined);assert.deepEqual(report.childOverflowIds,['live-child3']);
 assert.ok(!liveOfficeSeats(bound.topology,bound.snapshot.agents).some(seat=>seat.geometryId==='self-child-3'));
});

test('public host API exposes the current two-child capacity',()=>{ assert.equal(exportedChildCapacity,2); });

test('GitHub dedicated identity is opt-in, separate from common capacity, and cannot double-seat',()=>{
 const legacy=topology(17);
 assert.equal(liveOfficeSeats(legacy,[]).find(s=>s.geometryId==='github-desk')?.empty,true);
 const t={...legacy,githubAgentId:'repair'};
 const report=liveOfficeSeatReport(t);
 assert.equal(report.assignments.repair,'github-desk');
 assert.equal(Object.keys(report.assignments).length,20);
 assert.deepEqual(report.teamOverflowIds,['member17']);
 const dedicated=liveOfficeSeats(t,[{id:'repair',name:'GitHub Agent',character:'github'}]).find(s=>s.geometryId==='github-desk')!;
 assert.equal(dedicated.persona,'github');assert.equal(dedicated.kind,'github');assert.equal(dedicated.isLeader,false);
 for(const githubAgentId of ['owner','child1','member1',''])assert.throws(()=>validateTopology({...legacy,githubAgentId}));
});
test('removed table 3 positions reject with an explicit migration instruction and never become GitHub desk',()=>{
 const c=config();
 for(const position of [1,2,3])assert.throws(()=>parseOfficeConfig({...c,office:{...c.office,team:{...c.office.team,seatAssignments:{a:`public-table-3-seat-${position}`}}}}),/table 3 was removed.*explicitly reassign/);
 assert.throws(()=>parseOfficeConfig({...c,office:{...c.office,team:{...c.office.team,seatAssignments:{a:'github-desk'}}}}),/Invalid public/);
});
test('GitHub config roundtrips, binds only exact identity and retains status/freshness without invention',()=>{
 const base=config();const c:OfficeConfig={...base,seats:[...base.seats,{id:'repair',name:'GitHub Agent',character:'github',selector:{sourceId:'fixture',instanceId:'repair',epoch:{policy:'exact',value:'e1'}}}],office:{...base.office,githubSeatId:'repair'}};
 assert.deepEqual(importOfficeConfig(exportOfficeConfig(c)),c);
 for(const githubSeatId of ['owner','a','missing',undefined])assert.throws(()=>parseOfficeConfig({...c,office:{...c.office,githubSeatId}}));
 const empty=bindOffice(c,{agents:[],receivedAt:'',identityCoverage:'complete'});
 assert.equal(empty.bindings.repair,null);assert.equal(empty.snapshot.agents.length,0);
 assert.equal(liveOfficeSeatReport(empty.topology).assignments[empty.topology.githubAgentId!],'github-desk');
 const actor={id:'observed',name:'collector',character:'unknown' as const,status:'waiting' as const,source:'fixture',observedAt:null,sourceFreshness:'stale' as const,validForMs:1000,latestUserRequest:null,identity:{sourceId:'fixture',instanceId:'repair',collectorEpoch:'e1'}};
 const bound=bindOffice(c,{agents:[actor],receivedAt:'',identityCoverage:'complete'});
 assert.equal(bound.topology.githubAgentId,'observed');assert.equal(bound.snapshot.agents[0].character,'github');
 assert.equal(bound.snapshot.agents[0].status,'waiting');assert.equal(bound.snapshot.agents[0].sourceFreshness,'stale');
 const changed=bindOffice(c,{agents:[{...actor,identity:{...actor.identity,collectorEpoch:'e2'}}],receivedAt:'',identityCoverage:'complete'});
 assert.equal(changed.bindings.repair,null);assert.equal(changed.snapshot.agents.length,0);
});
