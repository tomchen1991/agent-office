import test from 'node:test';
import assert from 'node:assert/strict';
import {DEMO_STAGES,TOTAL_DEMO_MS,initialDemoState,demoReducer,demoPosition,stageStart} from '../src/demoTimeline.ts';
test('complete demo visits all seven visible actions in order and stops without loop',()=>{
 let state=initialDemoState();const seen=[];
 for(const stage of DEMO_STAGES){seen.push(demoPosition(state).stage);state=demoReducer(state,{type:'tick',deltaMs:stage.durationMs});}
 assert.deepEqual(seen,['arrival','sit','work','slack','error','stand','exit']);assert.equal(state.completed,true);assert.equal(state.running,false);assert.equal(state.elapsedMs,TOTAL_DEMO_MS);
 assert.equal(demoReducer(state,{type:'tick',deltaMs:1000}),state);
});
test('pause freezes stage and resume advances from same time',()=>{
 let state=demoReducer(initialDemoState(),{type:'tick',deltaMs:1700});state=demoReducer(state,{type:'pause'});
 assert.equal(demoReducer(state,{type:'tick',deltaMs:9000}),state);
 state=demoReducer(state,{type:'play'});state=demoReducer(state,{type:'tick',deltaMs:300});assert.equal(state.elapsedMs,2000);
});
test('restart and completed replay reset all stage time without retained error state',()=>{
 let state=demoReducer(initialDemoState(),{type:'tick',deltaMs:TOTAL_DEMO_MS});
 state=demoReducer(state,{type:'play'});assert.deepEqual(state,initialDemoState());
 state=demoReducer(state,{type:'jump',stage:'error'});state=demoReducer(state,{type:'restart'});assert.equal(demoPosition(state).stage,'arrival');
});
test('rapid stage jumps latest wins and paused selection stays paused',()=>{
 let state=demoReducer(initialDemoState(),{type:'pause'});
 for(const stage of ['exit','slack','sit','work'] as const) state=demoReducer(state,{type:'jump',stage});
 assert.equal(state.running,false);assert.equal(state.elapsedMs,stageStart('work'));assert.equal(demoPosition(state).progress,0);
});
test('invalid deltas never advance and overshoot clamps complete',()=>{
 const state=initialDemoState();for(const deltaMs of [NaN,Infinity,-1,0])assert.equal(demoReducer(state,{type:'tick',deltaMs}),state);
 const done=demoReducer(state,{type:'tick',deltaMs:100000});assert.equal(done.elapsedMs,TOTAL_DEMO_MS);assert.equal(demoPosition(done).progress,1);
});

test('walk uses four actual frame slots and each seated action has separate pose slots',async()=>{
 const {demoFrame}=await import('../src/demoTimeline.ts');
 assert.deepEqual([0,160,320,480].map(stageElapsedMs=>demoFrame({stage:'arrival',stageElapsedMs,progress:0}).frame),[0,1,2,3]);
 assert.deepEqual([0,260].map(stageElapsedMs=>demoFrame({stage:'work',stageElapsedMs,progress:0}).frame),[0,1]);
 assert.equal(demoFrame({stage:'slack',stageElapsedMs:0,progress:0}).frame,2);
 assert.equal(demoFrame({stage:'error',stageElapsedMs:0,progress:0}).frame,4);
 assert.equal(demoFrame({stage:'sit',stageElapsedMs:1800,progress:0.9}).frame,5);
 assert.equal(demoFrame({stage:'stand',stageElapsedMs:1800,progress:0.9}).frame,7);
});
test('reduced-motion uses still action poses independent of clock',async()=>{
 const {demoFrame}=await import('../src/demoTimeline.ts');
 for(const stage of DEMO_STAGES.map(item=>item.id)) assert.deepEqual(demoFrame({stage,stageElapsedMs:0,progress:0},true),demoFrame({stage,stageElapsedMs:1234,progress:0.9},true));
});
