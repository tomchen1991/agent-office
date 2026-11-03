import { useState } from 'react';
import { App } from './App';
import { LifecycleDemo } from './LifecycleDemo';
import { WholeOfficeDemo } from './WholeOfficeDemo';
import { LiveOfficeExample } from './LiveOfficeExample';
export function DemoShell() {
  const [view,setView]=useState<'office'|'live'|'demo'|'adapters'>('office');
  return <>
    <nav className="view-switcher" aria-label="演示与接入视图">
      <button aria-pressed={view==='office'} onClick={()=>setView('office')}>办公室</button>
      <button aria-pressed={view==='live'} onClick={()=>setView('live')}>状态测试</button>
      <button aria-pressed={view==='demo'} onClick={()=>setView('demo')}>角色动作</button>
      <button aria-pressed={view==='adapters'} onClick={()=>setView('adapters')}>数据详情</button>
    </nav>
    {view==='office'?<WholeOfficeDemo/>:view==='live'?<LiveOfficeExample/>:view==='demo'?<LifecycleDemo/>:<App/>}
  </>;
}
