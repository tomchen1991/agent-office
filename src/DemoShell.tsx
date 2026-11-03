import { useState } from 'react';
import { App } from './App';
import { LifecycleDemo } from './LifecycleDemo';
export function DemoShell() {
  const [view,setView]=useState<'demo'|'adapters'>('demo');
  return <>
    <nav className="view-switcher" aria-label="演示与接入视图">
      <button aria-pressed={view==='demo'} onClick={()=>setView('demo')}>完整动作演示</button>
      <button aria-pressed={view==='adapters'} onClick={()=>setView('adapters')}>接入层 / 多 Agent 办公室</button>
    </nav>
    {view==='demo'?<LifecycleDemo/>:<App/>}
  </>;
}
