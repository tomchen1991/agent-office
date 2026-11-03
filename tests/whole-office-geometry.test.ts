import test from 'node:test';
import assert from 'node:assert/strict';
import {demoCharacters} from '../src/demoAssets.ts';
import {demoFrame} from '../src/demoTimeline.ts';
import {wholeOfficeSeats,officeRoute,officeApproachPoint,pointAlongOfficeRoute,officeActorPlacement,officeTravelTiming} from '../src/wholeOfficeGeometry.ts';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('office privilege stays independent from explicitly configured team leader',()=>{
 for(const layout of ['leader-desks','peer-table'] as const){
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
 for(const layout of ['leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const route=officeRoute(seat),last=pointAlongOfficeRoute(route,1),first=pointAlongOfficeRoute(route,0);
  assert.equal(first.x,640);assert.equal(first.y,808);assert.equal(last.x,officeApproachPoint(seat).x);assert.equal(last.y,officeApproachPoint(seat).y);
  if(seat.kind!=='team'){assert.ok(route.some(p=>p.x===570&&p.y===685));assert.ok(route.some(p=>p.x===640&&p.y===685));}
  for(let t=0;t<=1;t+=.01){const p=pointAlongOfficeRoute(route,t);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));}
 }
});
test('all office seats retain four boundary contact positions and unchanged seated endpoints',()=>{
 for(const layout of ['leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
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
 for(const layout of ['leader-desks','peer-table'] as const)for(const seat of wholeOfficeSeats(layout)){
  const c=demoCharacters.find(c=>c.id===seat.persona)!;
  for(const t of [3880,3900,3999]){
   const p=officeActorPlacement(seat,c,'arrival',t,t/4000);
   close(p.x,officeApproachPoint(seat).x);close(p.y,officeApproachPoint(seat).y);
   assert.deepEqual(demoFrame({stage:'arrival',stageElapsedMs:p.motionElapsedMs,progress:t/4000}),demoFrame({stage:'sit',stageElapsedMs:0,progress:0}));
  }
 }
});
