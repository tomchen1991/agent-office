import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {act,createElement,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';

test('mounted whole office: all personas share full lifecycle, user pause survives loading, layout and teardown',async()=>{
 const vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
 const names=['window','document','HTMLElement','Image','IS_REACT_ACT_ENVIRONMENT'];
 const original=Object.fromEntries(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const pending:(()=>void)[]=[];
 class LoadedImage {onload:(()=>void)|null=null;onerror:(()=>void)|null=null;set src(_value:string){pending.push(()=>this.onload?.());}}
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Image:LoadedImage,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 let reduced=false,clock=0,handle=0;
 const listeners=new Set<()=>void>(),frames=new Map<number,FrameRequestCallback>();
 Object.defineProperty(dom.window,'matchMedia',{value:()=>({get matches(){return reduced;},addEventListener:(_:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:()=>void)=>listeners.delete(fn)})});
 dom.window.requestAnimationFrame=fn=>{frames.set(++handle,fn);return handle;};dom.window.cancelAnimationFrame=id=>{frames.delete(id);};
 const container=dom.window.document.getElementById('root')!;const root=createRoot(container);
 const button=(label:string)=>{const found=[...container.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert.ok(found,`Missing ${label}`);return found;};
 const click=async(label:string)=>{await act(async()=>{button(label).dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
 const step=async(count=1)=>{for(let i=0;i<count;i++){clock+=100;const jobs=[...frames.values()];frames.clear();await act(async()=>jobs.forEach(fn=>fn(clock)));}};
 const scene=()=>container.querySelector('[data-office-stage]')!;
 try{
  const {WholeOfficeDemo}=await vite.ssrLoadModule('/src/WholeOfficeDemo.tsx');
  await act(async()=>root.render(createElement(StrictMode,null,createElement(WholeOfficeDemo))));
  await click('跳转到工作中');await act(async()=>pending.splice(0).forEach(fn=>fn()));
  assert.equal(scene().getAttribute('data-office-stage'),'work');assert.equal(frames.size,0);
  const actors=[...container.querySelectorAll('[data-office-actor]')];
  for(const id of ['self','deepseek','chatgpt','grok'])assert.ok(actors.some(actor=>actor.getAttribute('data-office-actor')===id),id);
  assert.match(container.textContent!,/独立办公室/);assert.match(container.textContent!,/模拟|演示/);
  assert.equal(container.querySelectorAll('[data-office-actor][data-office-seat-kind="simulated-child"]').length,3);
  const selfBefore=container.querySelector<HTMLElement>('[data-office-actor="self"]')!.style.cssText;
  await click('平等协作桌');assert.equal(scene().getAttribute('data-office-layout'),'peer-table');assert.equal(container.querySelectorAll('[data-office-shared-table]').length,1);assert.equal(frames.size,0);
  assert.equal(container.querySelector<HTMLElement>('[data-office-actor="self"]')!.style.cssText,selfBefore);
  assert.equal(container.querySelectorAll('[data-office-desk][data-office-seat-kind="team"]').length,0);
  await click('主从工位');assert.equal(scene().getAttribute('data-office-layout'),'leader-desks');assert.equal(container.querySelectorAll('[data-office-desk][data-office-seat-kind="team"]').length,3);assert.equal(frames.size,0);

  await click('重播办公室演示');const stages=new Set<string>();
  for(let i=0;i<263;i++){stages.add(scene().getAttribute('data-office-stage')!);await step();}
  assert.deepEqual([...stages],['arrival','sit','work','slack','error','stand','exit']);
  assert.equal(scene().getAttribute('data-office-complete'),'true');assert.equal(frames.size,0);
  await click('重播办公室演示');await step(4);await click('暂停办公室演示');
  const stopped=scene().getAttribute('data-office-stage');await step(10);assert.equal(scene().getAttribute('data-office-stage'),stopped);assert.equal(frames.size,0);
  await click('播放办公室演示');await step(3);assert.equal(frames.size,1);
  await act(async()=>{reduced=true;listeners.forEach(fn=>fn());});assert.equal(frames.size,0);
  await click('跳转到Error');assert.equal(scene().getAttribute('data-office-stage'),'error');assert.equal(frames.size,0);
  await act(async()=>root.unmount());await act(async()=>pending.splice(0).forEach(fn=>fn()));assert.equal(frames.size,0);assert.equal(listeners.size,0);
 }finally{
  await act(async()=>{try{root.unmount();}catch{}});dom.window.close();await vite.close();
  for(const [key,descriptor]of Object.entries(original)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
 }
});
