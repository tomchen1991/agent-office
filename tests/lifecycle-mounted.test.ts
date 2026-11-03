import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {JSDOM} from 'jsdom';
import {act,createElement,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {demoCharacters} from '../src/demoAssets.ts';

test('mounted full demonstration: four independent selections, action frames, pause/replay and teardown',async()=>{
 const vite=await createServer({server:{middlewareMode:true,watch:null,hmr:false},appType:'custom'});
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
 const names=['window','document','HTMLElement','Image','IS_REACT_ACT_ENVIRONMENT'];
 const original=Object.fromEntries(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let autoLoad=false; const pendingImages: (()=>void)[]=[];
 class LoadedImage {onload:(()=>void)|null=null;onerror:(()=>void)|null=null;set src(_value:string){const loaded=()=>this.onload?.();pendingImages.push(loaded);if(autoLoad)queueMicrotask(loaded);}}
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Image:LoadedImage,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 let reduced=false,clock=0,handle=0;
 const listeners=new Set<()=>void>(),frames=new Map<number,FrameRequestCallback>();
 Object.defineProperty(dom.window,'matchMedia',{value:()=>({get matches(){return reduced;},addEventListener:(_:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_:string,fn:()=>void)=>listeners.delete(fn)})});
 dom.window.requestAnimationFrame=fn=>{frames.set(++handle,fn);return handle;};dom.window.cancelAnimationFrame=id=>{frames.delete(id);};
 const container=dom.window.document.getElementById('root')!;const root=createRoot(container);
 const click=async(el:Element)=>{await act(async()=>{el.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));});};
 const button=(label:string)=>{const found=[...container.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert.ok(found,`Missing ${label}`);return found;};
 const step=async(count=1)=>{for(let i=0;i<count;i++){clock+=100;const jobs=[...frames.values()];frames.clear();await act(async()=>jobs.forEach(fn=>fn(clock)));}};
 const scene=()=>container.querySelector('[data-demo-stage]')!;
 // Fixture loading does not assert real artwork quality; actual atlas/browser inspection is separate.
 const characters=demoCharacters.map(c=>({...c,ready:true,locomotion:{...c.locomotion,src:`fixture/${c.id}-walk.png`},seated:{...c.seated,src:`fixture/${c.id}-seat.png`}}));
 try {
  const {LifecycleDemo}=await vite.ssrLoadModule('/src/LifecycleDemo.tsx');
  await act(async()=>root.render(createElement(StrictMode,null,createElement(LifecycleDemo,{characters}))));
  // A stage jump while slow atlas requests load must keep explicit pause intent.
  await click([...container.querySelectorAll('.lc-stage-nav button')].find(b=>b.textContent?.includes('工作中'))!);
  await act(async()=>pendingImages.splice(0).forEach(loaded=>loaded()));
  assert.equal(scene().getAttribute('data-demo-stage'),'work');assert.equal(frames.size,0);
  autoLoad=true;await click(button('从头重新播放'));
  await step(3);const before=container.querySelector('[data-demo-frame]')?.getAttribute('data-demo-frame');await step(2);
  assert.notEqual(container.querySelector('[data-demo-frame]')?.getAttribute('data-demo-frame'),before);
  await click(button('暂停'));const progress=container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow');await step(8);
  assert.equal(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),progress);assert.equal(frames.size,0);
  await click(button('播放'));await step(4);assert.notEqual(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),progress);
  for(const character of characters){
   const choice=container.querySelector(`.character-${character.id}`)!;await click(choice);
   const stages=new Set<string>();
   for(let i=0;i<263;i++){stages.add(scene().getAttribute('data-demo-stage')!);await step();}
   assert.deepEqual([...stages],['arrival','sit','work','slack','error','stand','exit']);
   assert.equal(scene().getAttribute('data-demo-character'),character.id);assert.equal(scene().getAttribute('data-demo-complete'),'true');assert.equal(frames.size,0);
   assert.equal(container.querySelector<HTMLElement>('.lc-character')?.style.getPropertyValue('--contact-x'),`${(1-character.locomotion.anchor.x)*100}%`);
   await click(button('重新播放'));assert.equal(scene().getAttribute('data-demo-stage'),'arrival');
  }
  await act(async()=>{reduced=true;listeners.forEach(fn=>fn());});assert.equal(frames.size,0);
  const work=[...container.querySelectorAll('.lc-stage-nav button')].find(b=>b.textContent?.includes('工作中'))!;await click(work);
  assert.equal(scene().getAttribute('data-demo-stage'),'work');assert.equal(frames.size,0);
  // Old image callbacks cannot resurrect a replaced/unmounted character session.
  autoLoad=false;await click(container.querySelector('.character-self')!);await click(container.querySelector('.character-deepseek')!);
  await act(async()=>pendingImages.splice(0).forEach(loaded=>loaded()));assert.equal(scene().getAttribute('data-demo-character'),'deepseek');
  await click(container.querySelector('.character-grok')!);await act(async()=>root.unmount());
  await act(async()=>pendingImages.splice(0).forEach(loaded=>loaded()));assert.equal(frames.size,0);assert.equal(listeners.size,0);
 }finally{
  await act(async()=>{try{root.unmount();}catch{}});dom.window.close();await vite.close();
  for(const [key,descriptor]of Object.entries(original)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
 }
});
