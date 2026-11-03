import { useEffect, useState } from 'react';
import { childSeats, requestSummary, statusLabels } from './model';
import type { AgentSnapshot } from './model';
const asset = (file: string) => `${import.meta.env.BASE_URL}assets/self-agent/${file}`;
const demo: AgentSnapshot = {
  id: 'demo-self', character: 'self', name: '自研 Agent', status: 'idle',
  latestUserRequest: { summary: '在虚拟办公室里展示 Agent，并从待机动画开始逐步验证。', receivedAt: '2026-11-03T01:09:18Z' },
  childAgentIds: ['child-1', 'child-2', 'child-3', 'child-4'],
};
export function App() {
  const [playing, setPlaying] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPlaying(!media.matches);
    const changed = () => setPlaying(!media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  const seats = childSeats(demo.childAgentIds);
  return <main>
    <header><div className="brand-mark" aria-hidden="true">✦</div><div><span className="eyebrow">AGENT OFFICE / 001</span><h1>先让一个小人，动起来。</h1></div><span className="stage-tag">素材验证阶段</span></header>
    <div className="layout">
      <section className="preview-panel" aria-labelledby="preview-title">
        <div className="panel-top"><h2 id="preview-title">自研 Agent · 待机样例</h2><span className="status">{statusLabels[demo.status]}</span></div>
        <button className="character-button" aria-label="查看自研 Agent 的示例用户请求" aria-expanded={details} aria-controls="agent-details" onClick={() => setDetails(!details)}>
          <img className="character" src={asset(playing ? 'idle-preview-v2.gif' : 'standing-v2.png')} alt="紫发双马尾、洛丽塔裙装，手持星月紫晶镰刀的 Q 版角色" />
          <span className="character-hint">点击角色查看示例请求</span>
        </button>
        <div className="controls"><button className="primary-button" onClick={() => setPlaying(!playing)} aria-pressed={playing}>{playing ? '暂停动画' : '播放动画'}</button><span>约 2.93 秒循环 · 非最终生产素材</span></div>
      </section>
      <aside>
        <section className="info-card"><span className="eyebrow">当前已确认</span><h2>形象先行，逐步搭建</h2><p>紫发双马尾、软萌洛丽塔与华丽星月镰刀。当前只预览已确认素材，不连接真实采集端。</p><div className="detail-row"><span>画风方向</span><strong>A · 强轮廓</strong></div><div className="detail-row"><span>动作阶段</span><strong>站姿待机</strong></div><div className="detail-row"><span>技术方向</span><strong>React + TypeScript</strong></div></section>
        <section id="agent-details" className="info-card request-card" hidden={!details}><span className="eyebrow">模拟数据 / 非真实采集</span><h2>最近一次用户请求</h2><p>{requestSummary(demo)}</p><time dateTime={demo.latestUserRequest!.receivedAt}>{new Date(demo.latestUserRequest!.receivedAt).toLocaleString('zh-CN')}</time><div className="children"><span>子 Agent 座位示意</span><div>{seats.visible.map((id, index) => <span className="seat" key={id}>{index + 1}</span>)}{seats.overflow > 0 && <span className="seat overflow">+{seats.overflow}</span>}</div></div></section>
        <section className="asset-links"><h2>原始素材</h2><a href={asset('standing-v2.png')} download>透明站姿底图 <span>PNG ↗</span></a><a href={asset('idle-preview-v2.gif')} download>循环动画预览 <span>GIF ↗</span></a><a href={asset('idle-frames-v2.png')} download>透明四帧图集 <span>PNG ↗</span></a></section>
      </aside>
    </div>
    <footer>这是独立素材预览骨架，不是完整办公室或已完成的 Electron 集成。<br/>现有图像仍为高分辨率像素风参考；帧间存在轻微轮廓变化。</footer>
  </main>;
}
