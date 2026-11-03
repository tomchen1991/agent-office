import test from 'node:test';
import assert from 'node:assert/strict';
import {demoCharacters} from '../src/demoAssets.ts';
import {demoFrame} from '../src/demoTimeline.ts';
import {fixedOfficeSeats,fixedOfficeTables,OFFICE_WORLD,wholeOfficeSeats,officeRoute,officeApproachPoint,pointAlongOfficeRoute,officeActorPlacement,officeTravelTiming} from '../src/wholeOfficeGeometry.ts';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('office privilege stays independent from explicitly configured team leader',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const){
  const seats=wholeOfficeSeats(layout);assert.equal(seats.length,7);assert.equal(new Set(seats.map(s=>s.id)).size,7);
  assert.deepEqual(seats.filter(s=>s.kind==='team').map(s=>s.persona).sort(),['chatgpt','deepseek','grok']);
  assert.equal(seats.filter(s=>s.kind==='simulated-child').length,3);
  assert.equal(seats.find(s=>s.id==='self')!.kind,'owner');
  assert.equal(seats.filter(s=>s.role.includes('负责人')).length,layout==='leader-desks'?1:0);
 }
 assert.equal(wholeOfficeSeats('leader-desks',0).length,4);assert.equal(wholeOfficeSeats('leader-desks',99).length,7);
 assert.deepEqual(wholeOfficeSeats('leader-desks').filter(s=>s.kind!=='team'),wholeOfficeSeats('peer-table').filter(s=>s.kind!=='team'));
});
test('private routes cross doorway before travelling inside and terminate at the calibrated chair approach',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const route=officeRoute(seat),last=pointAlongOfficeRoute(route,1),first=pointAlongOfficeRoute(route,0);
  assert.equal(first.x,780);assert.equal(first.y,1010);close(last.x,officeApproachPoint(seat).x);close(last.y,officeApproachPoint(seat).y);
  if(seat.kind!=='team'){assert.ok(route.some(p=>p.x===518&&p.y===980));assert.ok(route.some(p=>p.x===780&&p.y===980));}
  for(let t=0;t<=1;t+=.01){const p=pointAlongOfficeRoute(route,t);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}
 }
});
test('all office seats retain four boundary contact positions and unchanged seated endpoints',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const character=demoCharacters.find(c=>c.id===seat.persona)!;
  const place=(stage:Parameters<typeof officeActorPlacement>[2],t:number,p:number)=>officeActorPlacement(seat,character,stage,t,p);
  const wrapper=(p:ReturnType<typeof place>)=>({x:p.x-p.contactX*p.width,y:p.y-p.contactY*p.width});
  for(const [a,b]of [[place('arrival',4000,1),place('sit',0,0)],[place('sit',2000,1),place('work',0,0)],[place('error',3500,1),place('stand',0,0)],[place('stand',2000,1),place('exit',0,0)]]){
   close(wrapper(a).x,wrapper(b).x);close(wrapper(a).y,wrapper(b).y);assert.equal(a.mirrored,b.mirrored);
  }
  assert.equal(place('work',0,0).x,seat.x);assert.equal(place('work',0,0).y,seat.y);
  assert.equal(place('exit',4000,1).opacity,0);
 }
});

test('staggered travel releases distinct seats and finishes inside each shared four-second window',()=>{
 const seats=wholeOfficeSeats('leader-desks');assert.equal(new Set(seats.map(s=>officeTravelTiming(s).arrivalDelayMs)).size,seats.length);
 for(const seat of seats){
  const c=demoCharacters.find(c=>c.id===seat.persona)!,timing=officeTravelTiming(seat);
  const p=(stage:'arrival'|'exit',time:number,reduced=false)=>officeActorPlacement(seat,c,stage,time,time/4000,reduced);
  assert.equal(p('arrival',timing.arrivalDelayMs).opacity,0);assert.equal(p('arrival',4000).opacity,1);
  close(p('arrival',4000).x,officeApproachPoint(seat).x);close(p('arrival',4000).y,officeApproachPoint(seat).y);
  assert.equal(p('exit',timing.exitDelayMs).motionElapsedMs,0);assert.ok(timing.exitDelayMs+timing.exitTravelMs<=4000);
  assert.equal(p('exit',4000).opacity,0);assert.equal(p('arrival',0,true).opacity,1);assert.equal(p('exit',4000,true).opacity,1);
 }
});
test('whole-office sit and stand feet stay at the physical seated floor contact, never on the tabletop',()=>{
 for(const seat of wholeOfficeSeats('peer-table')){
  const c=demoCharacters.find(c=>c.id===seat.persona)!;
  const ground=officeApproachPoint(seat,c);
  assert.ok(ground.y>seat.y+20*seat.scale);
  for(const stage of ['sit','stand'] as const)for(let t=0;t<=2000;t+=100){const p=officeActorPlacement(seat,c,stage,t,t/2000);close(p.x,ground.x);close(p.y,ground.y);}
 }
});

test('staggered arrival ends in the exact planted pose used to start sitting',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const c=demoCharacters.find(c=>c.id===seat.persona)!;
  for(const t of [3880,3900,3999]){
   const p=officeActorPlacement(seat,c,'arrival',t,t/4000);
   close(p.x,officeApproachPoint(seat).x);close(p.y,officeApproachPoint(seat).y);
   assert.deepEqual(demoFrame({stage:'arrival',stageElapsedMs:p.motionElapsedMs,progress:t/4000}),demoFrame({stage:'sit',stageElapsedMs:0,progress:0}));
  }
 }
});

test('fixed floor has 23 permanent empty seats, 4 shared tables, 11 individual desks, and compact usable aisles',()=>{
 const seats=fixedOfficeSeats(); assert.equal(seats.length,23); assert.equal(new Set(seats.map(s=>s.id)).size,23);
 assert.ok(seats.every(s=>s.empty)); assert.equal(seats.filter(s=>s.kind==='team').length,19);
 assert.equal(seats.filter(s=>!s.sharedTable).length,11); assert.equal(fixedOfficeTables.length,4);
 for(const table of fixedOfficeTables){assert.equal(seats.filter(s=>s.tableId===table.id).length,3);assert.ok(table.x+table.width<OFFICE_WORLD.width);}
 const desks=seats.filter(s=>s.id.startsWith('public-desk-'));
 assert.equal(desks.length,10);assert.equal(new Set(desks.map(s=>s.y)).size,2);
 for(let i=1;i<5;i++)assert.ok(desks[i].x-90*desks[i].scale-(desks[i-1].x+240*desks[i-1].scale)>20);
 const demo=wholeOfficeSeats('independent-desks');assert.ok(demo.some(s=>s.kind==='team'&&s.sharedTable));assert.ok(demo.some(s=>s.kind==='team'&&!s.sharedTable));
});

test('shared seats form an inward-facing arc and mirrored Grok approaches from outside',()=>{
 const team=wholeOfficeSeats('peer-table').filter(s=>s.kind==='team');
 const left=team.find(s=>s.id==='deepseek')!,middle=team.find(s=>s.id==='chatgpt')!,right=team.find(s=>s.id==='grok')!;
 assert.ok(middle.y<left.y-50&&middle.y<right.y-50);assert.equal(left.mirrored,undefined);assert.equal(right.mirrored,true);
 assert.ok(team.every(s=>s.sharedTable));
 const c=demoCharacters.find(c=>c.id==='grok')!,route=officeRoute(right);
 assert.ok(route.at(-2)!.x>route.at(-1)!.x);
 const work=officeActorPlacement(right,c,'work',0,0);
 assert.equal(work.mirrored,true);close(work.contactX,1-c.seated.anchor.x);
 assert.ok(officeApproachPoint(right).x<right.x);
 assert.equal(officeActorPlacement(right,c,'exit',0,0).mirrored,false);
 assert.ok(fixedOfficeSeats().filter(s=>s.kind==='simulated-child').every(s=>s.sharedTable&&s.tableId==='private-table'));
});

test('all 23 physical routes stay inside the world and cross the partition only through the open door',()=>{
 for(const seat of fixedOfficeSeats()){
  const route=officeRoute(seat);
  for(let index=1;index<route.length;index++){
   const a=route[index-1],b=route[index];
   assert.ok(a.x>=0&&a.x<=OFFICE_WORLD.width&&a.y>=0&&a.y<=OFFICE_WORLD.height);
   if(Math.min(a.x,b.x)<650&&Math.max(a.x,b.x)>650){
    assert.equal(a.y,980);assert.equal(b.y,980);
   }
  }
  const character=demoCharacters.find(c=>c.id===seat.persona)!;
  const arrival=officeActorPlacement(seat,character,'arrival',4000,1);
  const sit=officeActorPlacement(seat,character,'sit',0,0);
  close(arrival.x,sit.x);close(arrival.y,sit.y);assert.equal(arrival.mirrored,sit.mirrored);
 }
 const timings=fixedOfficeSeats().map(officeTravelTiming);
 assert.equal(new Set(timings.map(t=>t.arrivalDelayMs)).size,23);
 assert.ok(timings.every(t=>t.exitDelayMs+t.exitTravelMs<=4000));
});

test('second density increment grows actual furniture without changing width or camera fit',()=>{
 assert.deepEqual(OFFICE_WORLD,{width:2250,height:1050});
 const seats=fixedOfficeSeats(),owner=seats.find(s=>s.id==='self')!,desks=seats.filter(s=>s.id.startsWith('public-desk-'));
 close(owner.scale/1.05,1.1/1.05);assert.ok(desks.every(s=>s.scale===.756));
 assert.equal(desks[5].y-desks[0].y,235);assert.equal(desks[1].x-desks[0].x,270);
 assert.equal(fixedOfficeTables[1].y,245);assert.equal(desks[0].y,580);
 assert.equal(fixedOfficeTables[0].scale,.65,'Private table preserves its constrained access aisle');
 for(const table of fixedOfficeTables.filter(t=>!t.private)){
  close(table.scale/.7,1.03);close(table.width,635*table.scale);close(table.height,268*table.scale);
 }
 const viewport={width:1108,height:590};
 const previousFit=Math.min(viewport.width/2250,viewport.height/1100);
 const newFit=Math.min(viewport.width/OFFICE_WORLD.width,viewport.height/OFFICE_WORLD.height);
 close(newFit,previousFit);
 close(.756*newFit/(.72*previousFit),1.05);
 assert.ok(OFFICE_WORLD.width*OFFICE_WORLD.height<2250*1100*.96);
 for(let i=2;i<4;i++) assert.ok(fixedOfficeTables[i].x-(fixedOfficeTables[i-1].x+fixedOfficeTables[i-1].width)>22);
});

test('route centers avoid other tabletop and desk-front envelopes with positive gaps',()=>{
 const seats=fixedOfficeSeats();
 const furniture=[
  ...fixedOfficeTables.map(t=>({id:t.id,left:t.x,right:t.x+t.width,top:t.y,bottom:t.y+t.height})),
  ...seats.filter(s=>!s.sharedTable).map(s=>({id:s.id,left:s.x-90*s.scale,right:s.x+240*s.scale,top:s.y+11.4*s.scale,bottom:s.y+131.1*s.scale})),
 ];
 for(const seat of seats){
  const route=officeRoute(seat);
  for(const item of furniture){
   if(item.id===(seat.tableId??seat.id))continue; // Final approach intentionally enters its own chair/table registration.
   for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i];
    assert.ok(a.x===b.x||a.y===b.y,'Furniture clearance assumes axis-aligned floor routes');
    const intersects=a.x===b.x
     ?a.x>item.left&&a.x<item.right&&Math.max(a.y,b.y)>item.top&&Math.min(a.y,b.y)<item.bottom
     :a.y>item.top&&a.y<item.bottom&&Math.max(a.x,b.x)>item.left&&Math.min(a.x,b.x)<item.right;
    assert.ok(!intersects,`${seat.id} route segment ${i} crosses ${item.id}`);
   }
  }
 }
});
