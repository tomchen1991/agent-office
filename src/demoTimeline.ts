import { seatingPose } from './demoSeating.ts';
/** Demonstration script only. These stages are not assertions about collector status. */
export type DemoStage = 'arrival' | 'sit' | 'work' | 'slack' | 'error' | 'stand' | 'exit';
export const DEMO_STAGES: readonly {id: DemoStage; label: string; durationMs: number}[] = [
  {id:'arrival',label:'进场',durationMs:4000},
  {id:'sit',label:'坐下',durationMs:2000},
  {id:'work',label:'工作中',durationMs:6000},
  {id:'slack',label:'摸鱼中',durationMs:4500},
  {id:'error',label:'Error',durationMs:3500},
  {id:'stand',label:'起身',durationMs:2000},
  {id:'exit',label:'退场',durationMs:4000},
];
export const TOTAL_DEMO_MS = DEMO_STAGES.reduce((sum,stage)=>sum+stage.durationMs,0);
export interface DemoState { elapsedMs: number; running: boolean; completed: boolean }
export type DemoEvent = {type:'tick';deltaMs:number} | {type:'play'} | {type:'pause'} | {type:'restart'} | {type:'jump';stage:DemoStage};
export function initialDemoState(): DemoState { return {elapsedMs:0,running:true,completed:false}; }
export function stageStart(stage: DemoStage): number {
  let start = 0;
  for (const item of DEMO_STAGES) { if (item.id===stage) return start; start+=item.durationMs; }
  throw new Error('Unknown demonstration stage');
}
export function demoPosition(state: DemoState): {stage:DemoStage;stageElapsedMs:number;progress:number} {
  let start=0;
  for (let index=0;index<DEMO_STAGES.length;index++) {
    const stage=DEMO_STAGES[index];
    if (state.elapsedMs < start+stage.durationMs || index===DEMO_STAGES.length-1) {
      const elapsed=Math.max(0,Math.min(stage.durationMs,state.elapsedMs-start));
      return {stage:stage.id,stageElapsedMs:elapsed,progress:elapsed/stage.durationMs};
    }
    start+=stage.durationMs;
  }
  throw new Error('Empty demonstration');
}
export function demoReducer(state:DemoState,event:DemoEvent):DemoState {
  switch(event.type) {
    case 'pause': return {...state,running:false};
    case 'play': return state.completed ? initialDemoState() : {...state,running:true};
    case 'restart': return initialDemoState();
    case 'jump': return {elapsedMs:stageStart(event.stage),running:state.running,completed:false};
    case 'tick': {
      if (!state.running || state.completed || !Number.isFinite(event.deltaMs) || event.deltaMs<=0) return state;
      const elapsedMs=Math.min(TOTAL_DEMO_MS,state.elapsedMs+event.deltaMs);
      const completed=elapsedMs===TOTAL_DEMO_MS;
      return {elapsedMs,running:!completed,completed};
    }
  }
}

export function demoFrame(position: ReturnType<typeof demoPosition>, reducedMotion = false): {sheet:'locomotion'|'seated';frame:number} {
  const {stage,stageElapsedMs,progress}=position;
  switch(stage) {
    case 'arrival': case 'exit': return {sheet:'locomotion',frame:reducedMotion?0:Math.floor(stageElapsedMs/160)%4};
    case 'sit': case 'stand': { const pose=seatingPose(stage,stageElapsedMs,reducedMotion); return {sheet:pose.sheet,frame:pose.frame}; }
    case 'work': return {sheet:'seated',frame:reducedMotion?0:Math.floor(stageElapsedMs/260)%2};
    case 'slack': return {sheet:'seated',frame:2+(reducedMotion?1:Math.floor(stageElapsedMs/900)%2)};
    case 'error': return {sheet:'seated',frame:4+(reducedMotion?1:Math.floor(stageElapsedMs/450)%2)};
  }
}
