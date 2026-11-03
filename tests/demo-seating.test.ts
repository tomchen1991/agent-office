import test from 'node:test';
import assert from 'node:assert/strict';
import {seatingPose,seatingPlacement,SEATED_CONTACT_Y,DEMO_SPRITE_WIDTH_PERCENT,DEMO_SCENE_ASPECT} from '../src/demoSeating.ts';
import {demoCharacters} from '../src/demoAssets.ts';
import {demoFrame} from '../src/demoTimeline.ts';
test('sitting stops and aligns before bending, then holds exact work pose',()=>{
 assert.equal(seatingPose('sit',0).frame,0);
 assert.equal(seatingPose('sit',150).frame,7);
 assert.equal(seatingPose('sit',800).frame,4);
 assert.equal(seatingPose('sit',1000).frame,5);
 assert.deepEqual(seatingPose('sit',1300),{sheet:'seated',frame:6,seatFootProgress:1,mirrored:false});
 assert.deepEqual(seatingPose('sit',1999),{sheet:'seated',frame:0,seatFootProgress:1,mirrored:false});
});
test('rise starts from error pose, plants through rise and turns before exit',()=>{
 assert.deepEqual(seatingPose('stand',0),{sheet:'seated',frame:5,seatFootProgress:1,mirrored:false});
 assert.equal(seatingPose('stand',550).frame,6);
 assert.equal(seatingPose('stand',800).frame,7);
 assert.deepEqual(seatingPose('stand',1999),{sheet:'locomotion',frame:0,seatFootProgress:0,mirrored:true});
});
test('all four keep feet planted throughout bend/rise, not an interpolated anatomical anchor',()=>{
 for(const c of demoCharacters){
  const place=(stage:'sit'|'stand',time:number)=>seatingPlacement(seatingPose(stage,time),c.locomotion.anchor,c.seated.anchor);
  for(const t of [560,800,1000,1400,1900])assert.deepEqual(place('sit',t),place('sit',560));
  for(const t of [0,220,400,600,850])assert.deepEqual(place('stand',t),place('stand',0));
  const entry=place('sit',0);assert.equal(entry.x,68);assert.equal(entry.y,67);
  const end=place('stand',1999);assert.equal(end.x,68);assert.equal(end.y,67);assert.equal(end.contactX,1-c.locomotion.anchor.x);
 }
});
test('seated atlas swap matches work wrapper exactly despite the different coordinate reference',()=>{
 for(const c of demoCharacters){
  const p=seatingPlacement(seatingPose('sit',1999),c.locomotion.anchor,c.seated.anchor);
  const w=DEMO_SPRITE_WIDTH_PERCENT,h=w*DEMO_SCENE_ASPECT;
  assert.ok(Math.abs((p.x-p.contactX*w)-(68-c.seated.anchor.x*w))<1e-10);
  assert.ok(Math.abs((p.y-p.contactY*h)-(SEATED_CONTACT_Y-c.seated.anchor.y*h))<1e-10);
 }
 assert.equal(SEATED_CONTACT_Y,64);
});
test('reduced motion selects seated and upright endpoints without movement',()=>{
 assert.deepEqual(seatingPose('sit',0,true),seatingPose('sit',1999,true));
 assert.deepEqual(seatingPose('stand',0,true),seatingPose('stand',1999,true));
 assert.equal(seatingPose('sit',0,true).sheet,'seated');assert.equal(seatingPose('stand',0,true).frame,7);
});
test('all five praised action frame functions remain unchanged across their durations',()=>{
 for(let t=0;t<6000;t+=37){
  assert.deepEqual(demoFrame({stage:'arrival',stageElapsedMs:t,progress:0.5}),{sheet:'locomotion',frame:Math.floor(t/160)%4});
  assert.deepEqual(demoFrame({stage:'exit',stageElapsedMs:t,progress:0.5}),{sheet:'locomotion',frame:Math.floor(t/160)%4});
  assert.deepEqual(demoFrame({stage:'work',stageElapsedMs:t,progress:0.5}),{sheet:'seated',frame:Math.floor(t/260)%2});
  assert.deepEqual(demoFrame({stage:'slack',stageElapsedMs:t,progress:0.5}),{sheet:'seated',frame:2+Math.floor(t/900)%2});
  assert.deepEqual(demoFrame({stage:'error',stageElapsedMs:t,progress:0.5}),{sheet:'seated',frame:4+Math.floor(t/450)%2});
 }
});
