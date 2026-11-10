import type { ResidentRole } from './residentVisuals';

export const residentDeskLabels: Record<ResidentRole, string> = {
  main: '主 Agent', 'auto-fix': 'Auto-fix', devops: 'DevOps', hotspot: '热点追踪',
};
/** Hand-drawn, code-native furniture decorations. These are not health indicators. */
export function ResidentDesk({ role }: { role: ResidentRole }) {
  return <svg viewBox="0 0 160 90" className={`wo-resident-prop wo-prop-${role}`} role="img" aria-label={`${residentDeskLabels[role]} 专属桌面装饰`}>
    {role === 'main' ? <>
      <path d="M18 64 62 60 84 68 42 74Z" fill="#dac6e6" stroke="#63446f" strokeWidth="3"/><path d="M42 74v8l42-6v-8M18 64v8l24 10" fill="#a888b9" stroke="#63446f" strokeWidth="3"/>
      <path d="M113 11a21 21 0 1 0 16 31 19 19 0 0 1-16-31Z" fill="#ecd9a8" stroke="#957ba5" strokeWidth="3"/><path d="M112 54v20m-17 4h34" stroke="#d3b1ea" strokeWidth="5"/>
      <path d="m58 22 3 8 9 2-9 3-3 8-3-8-8-3 8-2Z" fill="#ecd9ff"/>
    </> : role === 'auto-fix' ? <>
      <path d="M20 47h77v35H20Z" fill="#9e5963" stroke="#352d48" strokeWidth="4"/><path d="M39 47V35h38v12" fill="none" stroke="#dbac92" strokeWidth="6"/><path d="M20 61h77M55 55v13" stroke="#ecc3a4" strokeWidth="4"/>
      <path d="m120 16-9 9 5 11-21 27 9 8 23-27 11 1 9-12-13 2-7-8 3-13Z" fill="#c5c8de" stroke="#4b4b68" strokeWidth="3"/>
      <path d="M29 72h16m21 0h18" stroke="#e6a578" strokeWidth="3"/>
    </> : role === 'devops' ? <>
      <path d="M35 15h73v65H35Z" fill="#274956" stroke="#142c3c" strokeWidth="4"/><path d="M43 24h57v12H43Zm0 19h57v12H43Zm0 19h57v12H43Z" fill="#597e89" stroke="#acc9cb" strokeWidth="2"/>
      {[30,49,68].map(y => <g key={y}><path d={`M50 ${y}h29`} stroke="#203e4a" strokeWidth="3"/><rect x="88" y={y-2} width="5" height="4" fill="#becbd0"/></g>)}
      <path d="M117 65h24v14h-24Zm12-30v30m-7-24 7-7 7 7m-19-10 12-12 12 12" fill="none" stroke="#91bcc7" strokeWidth="3"/>
    </> : <>
      <path d="m18 35 61-9 7 48-61 9Z" fill="#e7d8b4" stroke="#77634c" strokeWidth="3"/><path d="m28 43 39-6m-38 15 40-6m-39 15 19-3m-18 12 35-5" stroke="#9e8160" strokeWidth="4"/>
      <circle cx="119" cy="39" r="24" fill="#5b5348" stroke="#d8af6c" strokeWidth="4"/><circle cx="119" cy="39" r="13" fill="none" stroke="#bb985f" strokeWidth="2"/><path d="M119 15v48M95 39h48m-24 0 16-15" stroke="#e3c386" strokeWidth="2"/><path d="M114 65v12h-15m15 0h23" fill="none" stroke="#9a7b58" strokeWidth="4"/>
    </>}
  </svg>;
}
