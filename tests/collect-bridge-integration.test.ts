import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectAdapter} from '../server/collect.ts';
import {registerOfficeIpc} from '../server/electronBridge.ts';
import type {OfficeIpcMain,OfficeIpcEvent,OfficeMainFrame} from '../server/electronBridge.ts';
import {createOfficePreloadApi,createBridgeAdapter} from '../src/bridge.ts';
import {bindOffice} from '../src/binding.ts';
import type {AdapterState} from '../src/core.ts';

test('synthetic collector pagination reaches main/preload/renderer and explicit binding without credentials',async()=>{
 const at='2026-11-03T00:00:00.000Z';let clock=0,id=0;
 const timers=new Map<number,()=>void>(),listeners=new Set<(event:unknown,payload:unknown)=>void>();
 const handlers=new Map<string,(...args:unknown[])=>void>();
 let invoke:Parameters<OfficeIpcMain['handle']>[1]|undefined;
 const ipcMain:OfficeIpcMain={handle(_channel,handler){invoke=handler;},removeHandler(){invoke=undefined;}};
 const frame:OfficeMainFrame={url:'app://office/index.html',origin:'app://office',send(_channel,payload){for(const listener of listeners)listener({},payload);}};
 const webContents={mainFrame:frame,getURL:()=>frame.url,isDestroyed:()=>false,isLoadingMainFrame:()=>false,on(event:string,fn:(...args:unknown[])=>void){handlers.set(event,fn);},removeListener(event:string){handlers.delete(event);}};
 const event:OfficeIpcEvent={sender:webContents,senderFrame:frame};
 const calls:number[]=[];
 const main=registerOfficeIpc(ipcMain);
 main.attachWindow({webContents,allowedDocument:{url:frame.url,origin:frame.origin},createAdapter:()=>createCollectAdapter({
  baseURL:'http://127.0.0.1:8000',token:()=> 'synthetic-private-token',now:()=>Date.parse(at),monotonicNow:()=>clock+=.37,
  setTimer(fn){timers.set(++id,fn);return id as unknown as ReturnType<typeof setTimeout>;},clearTimer(timer){timers.delete(timer as unknown as number);},
  fetch:async(input,options)=>{const url=new URL(String(input)),offset=Number(url.searchParams.get('offset')??0);calls.push(offset);
   assert.equal(new Headers(options?.headers).get('Origin'),null);
   const instances=Array.from({length:Math.min(32,257-offset)},(_,index)=>({sourceId:'synthetic',instanceId:`agent-${offset+index}`,collectorEpoch:'e1',wireVersion:2,connection:'connected',freshness:'fresh',status:'active',snapshotReceivedAt:at,staleAfterMs:90000}));
   return new Response(JSON.stringify({version:1,scope:'pi-v1',persistence:'memory',storageReady:true,startedAt:at,observedAt:at,processId:'synthetic-process',coverage:{omitted:false},total:257,instances,nextOffset:offset+32<257?offset+32:null}));
  },
 })});
 const preload=createOfficePreloadApi({invoke:async(_channel,command)=>invoke!(event,command),on(_channel,listener){listeners.add(listener);},removeListener(_channel,listener){listeners.delete(listener);}});
 const adapter=createBridgeAdapter(preload),states:AdapterState[]=[];adapter.subscribe(state=>states.push(state));
 try{
  adapter.connect();
  for(let i=0;i<200&&!states.some(state=>state.phase==='connected');i++)await new Promise<void>(resolve=>setImmediate(resolve));
  const state=states.find(state=>state.phase==='connected');assert.ok(state);assert.equal(state.snapshot!.agents.length,257);assert.equal(calls.length,9);assert.equal(state.snapshot!.identityCoverage,'partial');
  assert.ok(state.snapshot!.agents.every(agent=>Number.isSafeInteger(agent.validForMs)&&agent.latestUserRequest===null));
  assert.ok(!JSON.stringify(states).includes('synthetic-private-token'));assert.ok(!JSON.stringify(states).includes('127.0.0.1'));
  const bound=bindOffice({version:1,seats:[{id:'owner',name:'Configured owner',character:'self',selector:{sourceId:'synthetic',instanceId:'agent-0',epoch:{policy:'exact',value:'e1'}}}],office:{selfSeatId:'owner',childSeatIds:[],team:{layout:'independent-desks',memberSeatIds:[]}}},state.snapshot!);
  assert.equal(bound.snapshot.agents.length,1);assert.equal(bound.snapshot.agents[0].character,'self');assert.equal(bound.snapshot.agents[0].status,'working');assert.equal(bound.warnings.length,0);
 }finally{
  adapter.dispose();for(let i=0;i<5;i++)await Promise.resolve();main.dispose();
  assert.equal(timers.size,0);assert.equal(listeners.size,0);assert.equal(handlers.size,0);
 }
});
