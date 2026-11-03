import { useState } from 'react';
import { App } from './App';
import { LifecycleDemo } from './LifecycleDemo';
import { WholeOfficeDemo } from './WholeOfficeDemo';
export function DemoShell() {
  const [view,setView]=useState<'office'|'demo'|'adapters'>('office');
  return <>
    <nav className="view-switcher" aria-label="演示与接入视图">
      <button aria-pressed={view==='office'} onClick={()=>setView('office')}>整体办公室演示</button>
      <button aria-pressed={view==='demo'} onClick={()=>setView('demo')}>单角色动作检查</button>
      <button aria-pressed={view==='adapters'} onClick={()=>setView('adapters')}>接入层 / 数据视图</button>
    </nav>
    {view==='office'?<WholeOfficeDemo/>:view==='demo'?<LifecycleDemo/>:<App/>}
  </>;
}
