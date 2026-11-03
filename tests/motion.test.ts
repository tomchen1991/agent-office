import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileMotion, advanceMotion, TRANSITION_MS } from '../src/motion.ts';
import { selfMotionSlots } from '../src/motionSlots.ts';
import type { MotionTarget } from '../src/motion.ts';
const target: MotionTarget = {id: 'a', seat: 'owner', status: 'idle'};
test('arrival reaches configured seat then follows authoritative activity without moving again', () => {
  let state = reconcileMotion([], [target]); assert.equal(state[0].phase, 'arriving');
  state = advanceMotion(state, TRANSITION_MS / 2); assert.equal(state[0].progress, 0.5);
  state = reconcileMotion(state, [{...target, status: 'working'}]); assert.equal(state[0].progress, 0.5);
  state = advanceMotion(state, TRANSITION_MS / 2); assert.equal(state[0].phase, 'seated'); assert.equal(state[0].status, 'working');
  for (const status of ['stopping','unknown','idle'] as const) { state = reconcileMotion(state, [{...target,status}]); assert.equal(state[0].phase,'seated'); assert.equal(state[0].status,status); }
});
test('repeated targets do not restart arrival; rapid moves use latest target only', () => {
  const half = advanceMotion(reconcileMotion([], [target]), 300);
  assert.deepEqual(reconcileMotion(half, [target]), half);
  let state = reconcileMotion(half, [{...target, seat:'peer-1'}]);
  state = advanceMotion(state, 100);
  state = reconcileMotion(state, [{...target, seat:'leader-2'}]);
  assert.equal(state.length, 1); assert.equal(state[0].seat,'leader-2'); assert.equal(state[0].phase,'moving'); assert.equal(state[0].progress,0);
});
test('removal exits once, new epoch does not inherit old activity or request content', () => {
  let state = advanceMotion(reconcileMotion([], [target]),600);
  state = reconcileMotion(state,[{...target,id:'epoch-2',status:'unknown'}]);
  assert.equal(state.length,2); assert.equal(state.find(a=>a.id==='a')?.phase,'leaving');
  assert.equal(state.find(a=>a.id==='epoch-2')?.status,'unknown');
  state = advanceMotion(state,600); assert.deepEqual(state.map(a=>a.id),['epoch-2']);
});
test('rapid remove and return cancels exit with no duplicate or ghost actor', () => {
  let state = reconcileMotion(reconcileMotion([], [target]),[]);
  state = advanceMotion(state,200);
  state = reconcileMotion(state,[target]);
  assert.equal(state.length,1); assert.equal(state[0].phase,'arriving');
  state = advanceMotion(state,600); assert.equal(state[0].phase,'seated');
});
test('pause freezes motion but latest status and disconnect still invalidate activity', () => {
  const moving = advanceMotion(reconcileMotion([], [{...target,status:'working'}]),100);
  assert.equal(advanceMotion(moving,1000,{paused:true}),moving);
  const off = reconcileMotion(moving,[target],{connected:false});
  assert.equal(off[0].status,'unknown'); assert.equal(off[0].phase,'seated');
  assert.deepEqual(reconcileMotion(off,[],{connected:false}),[]);
});
test('reduced motion snaps to latest seat and removes departures without animation', () => {
  const state = reconcileMotion([], [target], {reducedMotion:true}); assert.equal(state[0].phase,'seated');
  assert.deepEqual(reconcileMotion(state,[],{reducedMotion:true}),[]);
  const exit = reconcileMotion(state,[]); assert.deepEqual(advanceMotion(exit,0,{reducedMotion:true}),[]);
});
test('duplicate identity or occupied slot is rejected rather than creating duplicate React actors', () => {
  assert.throws(()=>reconcileMotion([],[target,{...target,seat:'other'}]),/unique/);
  assert.throws(()=>reconcileMotion([],[target,{...target,id:'other'}]),/unique/);
});
test('invalid time cannot move backwards, long frame finishes once, pure input preserved', () => {
  const state = reconcileMotion([], [target]); const before = structuredClone(state);
  assert.equal(advanceMotion(state,NaN),state); assert.equal(advanceMotion(state,-100),state);
  assert.equal(advanceMotion(state,100000)[0].phase,'seated'); assert.deepEqual(state,before);
});
test('only idle has authored animation; all missing action slots explicitly fallback', () => {
  const slots = selfMotionSlots('./');
  assert.ok(slots.idle.animatedSource);
  for (const key of ['arrival','move','departure','active','stopping','unknown'] as const) { assert.equal(slots[key].animatedSource,undefined); assert.equal(slots[key].authoredAction,false); }
});

test('canceled animation callback cannot change state or schedule another frame', async () => {
  const { startMotionClock } = await import('../src/motionClock.ts');
  let next = 0;
  const jobs = new Map<number, (time: number) => void>();
  const deltas: number[] = [];
  const stop = startMotionClock({request(callback) {jobs.set(++next,callback);return next;},cancel(handle) {jobs.delete(handle);}}, delta=>deltas.push(delta));
  const late = jobs.get(1)!; stop(); late(500);
  assert.deepEqual(deltas,[]); assert.equal(jobs.size,0); assert.equal(next,1);
});
test('new clock starts from zero after pause; no catch-up jump from prior session', async () => {
  const { startMotionClock } = await import('../src/motionClock.ts');
  let callback!: (time: number)=>void;
  const deltas: number[] = [];
  const scheduler = {request(fn:(time:number)=>void) {callback=fn;return 1;},cancel() {}};
  const stop = startMotionClock(scheduler,delta=>deltas.push(delta)); callback(100);callback(150);stop();
  const stopAgain = startMotionClock(scheduler,delta=>deltas.push(delta));callback(10000);callback(10050);stopAgain();
  assert.deepEqual(deltas,[0,50,0,50]);
});

test('rapid epoch churn at one seat retains one departure and routes others to exit lane', async () => {
  const { retainedDepartureIds } = await import('../src/motion.ts');
  let state = reconcileMotion([], [target]);
  state = reconcileMotion(state,[{...target,id:'b'}]);
  state = reconcileMotion(state,[]);
  const retained = retainedDepartureIds(state,['owner'],[]);
  assert.equal(retained.size,1);
  assert.equal(state.filter(actor=>!retained.has(actor.id)).length,1);
  assert.equal(retainedDepartureIds(state,['owner'],['owner']).size,0);
});
