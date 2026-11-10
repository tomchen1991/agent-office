import test from 'node:test';
import assert from 'node:assert/strict';
import {demoCharacters} from '../src/demoAssets.ts';
import {demoFrame} from '../src/demoTimeline.ts';
import {fixedOfficeSeats,fixedOfficeTables,OFFICE_WORLD,wholeOfficeSeats,officeRoute,officeApproachPoint,pointAlongOfficeRoute,officeActorPlacement,officeTravelTiming,officeActorWidth,OFFICE_ACTOR_RATIO,OFFICE_DESK,officeLocalPoint} from '../src/wholeOfficeGeometry.ts';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('office privilege stays independent from explicitly configured team leader',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const){
  const seats=wholeOfficeSeats(layout);assert.equal(seats.length,9);assert.equal(new Set(seats.map(s=>s.id)).size,9);
  assert.deepEqual(seats.filter(s=>s.kind==='team'&&!s.id.startsWith('self-child-')).map(s=>s.persona).sort(),['chatgpt','deepseek','grok']);
  assert.equal(seats.filter(s=>s.id.startsWith('self-child-')&&s.sharedTable).length,2);
  assert.equal(seats.find(s=>s.id==='self')!.kind,'owner');
  assert.equal(seats.filter(s=>s.role.includes('负责人')).length,layout==='leader-desks'?1:0);
 }
 assert.equal(wholeOfficeSeats('leader-desks',0).length,7);assert.equal(wholeOfficeSeats('leader-desks',99).length,9);
 assert.deepEqual(wholeOfficeSeats('leader-desks').filter(s=>s.kind!=='team'),wholeOfficeSeats('peer-table').filter(s=>s.kind!=='team'));
});
test('private routes cross doorway before travelling inside and terminate at the calibrated chair approach',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const route=officeRoute(seat),last=pointAlongOfficeRoute(route,1),first=pointAlongOfficeRoute(route,0);
  assert.equal(first.x,780);assert.equal(first.y,1010);close(last.x,officeApproachPoint(seat).x);close(last.y,officeApproachPoint(seat).y);
  if(seat.kind==='owner'){assert.ok(route.some(p=>p.x===690&&p.y===470));assert.ok(route.some(p=>p.x===780&&p.y===980));}
  for(let t=0;t<=1;t+=.01){const p=pointAlongOfficeRoute(route,t);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}
 }
});
test('all office seats retain four boundary contact positions and unchanged seated endpoints',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const character=demoCharacters.find(c=>c.id===seat.persona) ?? demoCharacters[0];
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
  const c=demoCharacters.find(c=>c.id===seat.persona) ?? demoCharacters[0],timing=officeTravelTiming(seat);
  const p=(stage:'arrival'|'exit',time:number,reduced=false)=>officeActorPlacement(seat,c,stage,time,time/4000,reduced);
  assert.equal(p('arrival',timing.arrivalDelayMs).opacity,0);assert.equal(p('arrival',4000).opacity,1);
  close(p('arrival',4000).x,officeApproachPoint(seat).x);close(p('arrival',4000).y,officeApproachPoint(seat).y);
  assert.equal(p('exit',timing.exitDelayMs).motionElapsedMs,0);assert.ok(timing.exitDelayMs+timing.exitTravelMs<=4000);
  assert.equal(p('exit',4000).opacity,0);assert.equal(p('arrival',0,true).opacity,1);assert.equal(p('exit',4000,true).opacity,1);
 }
});
test('whole-office sit and stand feet stay at the physical seated floor contact, never on the tabletop',()=>{
 for(const seat of wholeOfficeSeats('peer-table')){
  const c=demoCharacters.find(c=>c.id===seat.persona) ?? demoCharacters[0];
  const ground=officeApproachPoint(seat,c);
  assert.ok(ground.y>seat.y+20*seat.scale);
  for(const stage of ['sit','stand'] as const)for(let t=0;t<=2000;t+=100){const p=officeActorPlacement(seat,c,stage,t,t/2000);close(p.x,ground.x);close(p.y,ground.y);}
 }
});

test('staggered arrival ends in the exact planted pose used to start sitting',()=>{
 for(const layout of ['independent-desks','leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const c=demoCharacters.find(c=>c.id===seat.persona) ?? demoCharacters[0];
  for(const t of [3880,3900,3999]){
   const p=officeActorPlacement(seat,c,'arrival',t,t/4000);
   close(p.x,officeApproachPoint(seat).x);close(p.y,officeApproachPoint(seat).y);
   assert.deepEqual(demoFrame({stage:'arrival',stageElapsedMs:p.motionElapsedMs,progress:t/4000}),demoFrame({stage:'sit',stageElapsedMs:0,progress:0}));
  }
 }
});

test('fixed floor has 20 permanent empty seats, 2 shared tables, 14 individual desks, and compact usable aisles',()=>{
 const seats=fixedOfficeSeats(); assert.equal(seats.length,20); assert.equal(new Set(seats.map(s=>s.id)).size,20);
 assert.ok(seats.every(s=>s.empty)); assert.equal(seats.filter(s=>s.kind==='team').length,16);
 assert.equal(seats.filter(s=>!s.sharedTable).length,14); assert.equal(fixedOfficeTables.length,2);
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
 assert.ok(fixedOfficeSeats().filter(s=>s.kind==='simulated-child').every(s=>!s.sharedTable&&!s.tableId&&!s.mirrored));
});

test('all 20 physical routes stay inside the world and cross each room partition through its door',()=>{
 for(const seat of fixedOfficeSeats()){
  const route=officeRoute(seat);
  for(let index=1;index<route.length;index++){
   const a=route[index-1],b=route[index];
   assert.ok(a.x>=0&&a.x<=OFFICE_WORLD.width&&a.y>=0&&a.y<=OFFICE_WORLD.height);
   if(Math.min(a.x,b.x)<700&&Math.max(a.x,b.x)>700){
    const doorY=seat.kind==='owner'?470:750;
    assert.equal(a.y,doorY);assert.equal(b.y,doorY);
   }
  }
  const character=demoCharacters.find(c=>c.id===seat.persona) ?? demoCharacters[0];
  const arrival=officeActorPlacement(seat,character,'arrival',4000,1);
  const sit=officeActorPlacement(seat,character,'sit',0,0);
  close(arrival.x,sit.x);close(arrival.y,sit.y);assert.equal(arrival.mirrored,sit.mirrored);
 }
 const timings=fixedOfficeSeats().map(officeTravelTiming);
 assert.equal(new Set(timings.map(t=>t.arrivalDelayMs)).size,20);
 assert.ok(timings.every(t=>t.exitDelayMs+t.exitTravelMs<=4000));
});

test('resident room expansion preserves furniture sizing, private office coordinates and shared table geometry',()=>{
 assert.deepEqual(OFFICE_WORLD,{width:2250,height:1050});
 const seats=fixedOfficeSeats(),owner=seats.find(s=>s.id==='self')!,desks=seats.filter(s=>s.id.startsWith('public-desk-'));
 close(owner.scale/1.05,1.1/1.05);assert.ok(desks.every(s=>s.scale===.756));
 assert.equal(desks[5].y-desks[0].y,225);assert.equal(desks[1].x-desks[0].x,270);
 assert.equal(fixedOfficeTables[1].y,245);assert.equal(desks[0].y,570);
 assert.ok(fixedOfficeTables.every(table=>!table.private),'Shared tables are public only');
 for(const table of fixedOfficeTables.filter(t=>!t.private)){
  close(table.scale/.7,1.03);close(table.width,635*table.scale*.9);close(table.height,268*table.scale);
 }
 assert.equal(owner.x,250);assert.equal(owner.y,340);
 assert.equal(OFFICE_WORLD.width,2250);assert.equal(OFFICE_WORLD.height,1050);
 for(let i=1;i<fixedOfficeTables.length;i++) assert.ok(fixedOfficeTables[i].x-(fixedOfficeTables[i-1].x+fixedOfficeTables[i-1].width)>23);
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


test('actors grow independently by 25% while desktop widths shrink by 10%',()=>{
 assert.equal(OFFICE_ACTOR_RATIO,1.25);
 close(OFFICE_DESK.frontWidth/330,.9);
 for(const seat of fixedOfficeSeats())for(const character of demoCharacters){
  const oldWidth=220*seat.scale;
  close(officeActorWidth(seat)/oldWidth,1.25);
  const work=officeActorPlacement(seat,character,'work',0,0);
  close(work.width,officeActorWidth(seat));
  close(work.width/(OFFICE_DESK.frontWidth*seat.scale)/(220/330),1.25/.9);
  // The registered seated hand contact does not move when the body grows.
  close(work.x,seat.x);close(work.y,seat.y);
  const keyboardCenter=officeLocalPoint({...seat,scale:seat.scale*OFFICE_ACTOR_RATIO},685,365.5);
  assert.ok(Math.abs(keyboardCenter.x-seat.x)<7);
  assert.ok(Math.abs(keyboardCenter.y-seat.y)<2);
  const approach=officeApproachPoint(seat,character);
  close(approach.y,seat.y+(character.locomotion.anchor.y-character.seated.anchor.y)*work.width);
 }
 for(const table of fixedOfficeTables)close(table.width/(635*table.scale),.9);
});


test('shared side seats inset the whole station so enlarged keyboards stay on the surface',()=>{
 for(const table of fixedOfficeTables){
  const seats=fixedOfficeSeats().filter(s=>s.tableId===table.id);
  // Verified against all four approved seated PNG masks (all eight frames).
  // Moving the center with the left station preserves their original clearance.
  assert.ok(seats[1].x-seats[0].x>=180*table.scale-1e-8);
  assert.ok(seats[2].x-seats[1].x>=180*table.scale);
  for(const seat of [seats[0],seats[2]]){
   const scale=seat.scale*OFFICE_ACTOR_RATIO;
   const corners=[officeLocalPoint({...seat,scale},630,358),officeLocalPoint({...seat,scale},740,373)];
   assert.ok(Math.min(...corners.map(p=>p.x))>=table.x+2,`${seat.id} keyboard extends beyond left edge`);
   assert.ok(Math.max(...corners.map(p=>p.x))<=table.x+table.width-2,`${seat.id} keyboard extends beyond right edge`);
  }
 }
});

test('children use public furniture rather than permanent private desks',()=>{
 assert.equal(fixedOfficeSeats().filter(seat=>seat.kind==='simulated-child').length,0);
 const children=wholeOfficeSeats('peer-table').filter(seat=>seat.id.startsWith('self-child-'));
 assert.equal(children.length,2);
 assert.ok(children.every(seat=>seat.tableId==='public-table-2'&&seat.sharedTable));
});

test('resident furniture assigns four distinct roles and separates operations from public tracking',()=>{
 const seats=fixedOfficeSeats(), residents=seats.filter(s=>s.residentRole);
 assert.deepEqual(residents.map(s=>s.residentRole),['main','auto-fix','devops','hotspot']);
 const main=residents[0],fix=residents[1],devops=residents[2],hotspot=residents[3];
 assert.equal(main.x,250);assert.equal(main.y,340);
 for(const seat of [fix,devops]){assert.ok(seat.x>40&&seat.x<700&&seat.y>550&&seat.y<1000);assert.ok(!seat.sharedTable);}
 assert.ok(hotspot.x>1700&&hotspot.y<550,'Hotspot stays in the upper public area outside both private rooms');
 assert.ok(residents.every(s=>s.empty),'Furniture definitions never invent present agents');
});
