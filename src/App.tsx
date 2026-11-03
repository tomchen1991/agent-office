import { useEffect, useRef, useState } from 'react';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeTopology } from './core';
import { freshness, validateTopology, displayStatus } from './core';
import { createMockAdapter, demoTopology } from './mock';

const asset = (file: string) => `${import.meta.env.BASE_URL}assets/self-agent/${file}`;
const statusLabels = { idle: '待机', working: '工作中', waiting: '等待输入', offline: '离线', unknown: '状态未知' };
const freshnessLabels = { fresh: '新鲜', stale: '已过期', unknown: '未知' };
const phaseLabels = { connecting: '连接中', connected: '已连接', disconnected: '已断开' };
function displayTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未知';
  return new Date(value).toLocaleString('zh-CN');
}

function AgentSeat({ agent, id, label, playing, selected, onSelect }: {
  agent?: OfficeAgent; id: string; label: string; playing: boolean; selected: boolean; onSelect: (id: string) => void;
}) {
  return <button className={`agent-seat ${selected ? 'selected' : ''}`} onClick={() => onSelect(id)} aria-pressed={selected} aria-label={`${agent?.name ?? id}，${label}，查看详情`}>
    <span className="desk-role">{label}</span>
    {agent?.character === 'self'
      ? <img className="avatar self-avatar" src={asset(playing ? 'idle-preview-v2.gif' : 'standing-v2.png')} alt="紫发双马尾与星月镰刀的自研 Agent；待机参考素材" />
      : <span className={`avatar placeholder ${agent?.character ?? 'unknown'}`}><span aria-hidden="true">{agent?.character === 'deepseek' ? 'D' : agent?.character === 'chatgpt' ? 'C' : agent?.character === 'grok' ? 'G' : '?'}</span><small>占位形象</small></span>}
    <span className="desk-top"><strong>{agent?.name ?? id}</strong><span className={`agent-status ${agent?.status ?? 'unknown'}`}>{agent ? statusLabels[agent.status] : '未收到数据'}</span></span>
  </button>;
}

export interface AppProps {
  adapterFactory?: () => OfficeAdapter;
  topology?: OfficeTopology;
  modeLabel?: string;
}
export function App({ adapterFactory = createMockAdapter, topology = demoTopology, modeLabel = '模拟数据' }: AppProps = {}) {
  validateTopology(topology);
  const isDefaultMock = adapterFactory === createMockAdapter;
  const [state, setState] = useState<AdapterState>({ phase: 'connecting', snapshot: null, error: null });
  const [enabled, setEnabled] = useState(true);
  const [retry, setRetry] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layout, setLayout] = useState<OfficeTopology['team']['layout']>(topology.team.layout);
  const [selected, setSelected] = useState(topology.selfAgentId);
  const receivedAt = useRef(performance.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setState(previous => ({ ...previous, phase: 'disconnected', error: null, snapshot: previous.snapshot ? { ...previous.snapshot, agents: previous.snapshot.agents.map(agent => ({...agent, status: 'unknown', sourceFreshness: 'unknown'})) } : null }));
      return;
    }
    const adapter = adapterFactory();
    const unsubscribe = adapter.subscribe(next => { setState(next); receivedAt.current = performance.now(); setElapsed(0); });
    adapter.connect();
    return () => { unsubscribe(); adapter.dispose(); };
  }, [enabled, retry, adapterFactory]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPlaying(!media.matches);
    const change = () => setPlaying(!media.matches);
    media.addEventListener('change', change);
    const timer = window.setInterval(() => setElapsed(performance.now() - receivedAt.current), 5000);
    return () => { media.removeEventListener('change', change); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    setLayout(topology.team.layout);
    setSelected(topology.selfAgentId);
  }, [topology]);
  const agents = (state.snapshot?.agents ?? []).map(agent => ({...agent, status: displayStatus(agent, elapsed, state.phase)}));
  const agent = agents.find(item => item.id === selected);
  const childIds = topology.childAgentIds.slice(0, 3);
  const overflow = Math.max(0, topology.childAgentIds.length - 3);
  const seat = (id: string, label: string) => <AgentSeat key={id} id={id} label={label} agent={agents.find(item => item.id === id)} playing={playing} selected={selected === id} onSelect={setSelected} />;
  const request = agent?.latestUserRequest;
  return <main>
    <header><div className="brand-mark" aria-hidden="true">✦</div><div><span className="eyebrow">AGENT OFFICE / 002</span><h1>小小办公室，开始上班。</h1></div><span className="stage-tag">交互原型 · {modeLabel}</span></header>
    <section className="toolbar" aria-label="预览设置">
      <div className="connection" role="status"><span className={`connection-dot ${state.phase}`} aria-hidden="true" />{modeLabel} · {phaseLabels[state.phase]}</div>
      <div className="toolbar-actions"><button onClick={() => setEnabled(!enabled)}>{enabled ? '断开数据源' : '连接数据源'}</button><button onClick={() => { setEnabled(true); setRetry(value => value + 1); }}>重新连接</button><button aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? '暂停待机动画' : '播放待机动画'}</button></div>
    </section>
    {state.snapshot?.coverage && <p className="warning" role="status">数据覆盖范围：{state.snapshot.coverage}</p>}
    {state.error && <p className="warning" role="alert">连接异常：{state.error}。可尝试重新连接。</p>}
    {state.phase === 'disconnected' && <p className="warning" role="status">数据源已断开。保留的画面不是实时状态；时间继续计算，过期后会标记。</p>}
    <div className="layout">
      <section className="office-scene" aria-label="Agent 办公室">
        <div className="scene-heading"><div><span className="eyebrow">OFFICE FLOOR</span><h2>一个办公室，两种协作方式</h2></div><span className="scene-note">点击工位查看用户请求</span></div>
        <section className="private-office" aria-labelledby="private-title"><div className="room-heading"><h3 id="private-title">自研 Agent · 独立办公室</h3><span>身份专属，不随团队领导者变化</span></div><div className="private-seats"><div className="owner-desk">{seat(topology.selfAgentId, '自研 Agent')}</div><div className="child-area"><span className="area-caption">子 Agent 协作工位</span><div className="child-seats">{childIds.map((id, index) => seat(id, `子 Agent ${index + 1}`))}{overflow > 0 && <span className="overflow" aria-label={`另有 ${overflow} 个子 Agent 未展示`}>+{overflow}</span>}{childIds.length === 0 && <p className="empty-state">暂未配置子 Agent</p>}</div><small>最多展示 3 个子 Agent，其余合并计数</small></div></div></section>
        <section className={`team-office ${layout}`} aria-labelledby="team-title"><div className="room-heading"><h3 id="team-title">公共协作区</h3><fieldset className="layout-picker"><legend>展示拓扑配置</legend><label><input type="radio" name="layout" checked={layout === 'leader-desks'} onChange={() => setLayout('leader-desks')} />主从工位</label><label><input type="radio" name="layout" checked={layout === 'peer-table'} onChange={() => setLayout('peer-table')} />平等协作</label></fieldset></div><p className="topology-note">{layout === 'leader-desks' ? '由显式配置指定团队负责人；不根据主机、模型或角色字段推断。' : '成员围坐共享协作桌；所有成员平等，不显示指挥席。'}</p><div className="team-seats">{topology.team.memberIds.map(id => <div key={id} className={layout === 'leader-desks' && id === topology.team.leaderId ? 'leader-seat' : ''}>{seat(id, layout === 'leader-desks' ? (id === topology.team.leaderId ? '团队负责人' : '协作成员') : '平等成员')}</div>)}</div>{layout === 'peer-table' && <div className="shared-table" aria-hidden="true">共享协作桌</div>}</section>
        <p className="scene-footnote">{isDefaultMock ? '这是固定的模拟快照，可用“重新连接”刷新观测时间；超过 30 秒会标记过期。' : '状态新鲜度依据数据源判定及接收后的本地经过时间，不比较服务器与客户端时钟。'}工位关系来自显式配置，不根据采集数据猜测。除自研角色外均为占位图标，尚未绘制最终像素形象。</p>
      </section>
      <aside>
        <section className="info-card request-card" aria-labelledby="details-title"><span className="eyebrow">AGENT INSPECTOR</span><h2 id="details-title">{agent?.name ?? selected}</h2><span className="mock-label">{isDefaultMock ? `${modeLabel} / 非真实采集` : modeLabel}</span><dl><div><dt>最近观测状态</dt><dd>{agent ? statusLabels[agent.status] : '未知：未收到该 Agent 数据'}</dd></div><div><dt>数据来源</dt><dd>{agent?.source || '未知'}</dd></div><div><dt>连接状态</dt><dd>{phaseLabels[state.phase]}</dd></div><div><dt>状态新鲜度</dt><dd>{agent ? freshnessLabels[freshness(agent, elapsed)] : '未知'}</dd></div><div><dt>状态观测时间</dt><dd><time dateTime={agent?.observedAt ?? undefined}>{displayTime(agent?.observedAt ?? null)}</time></dd></div></dl><div className="request-body"><h3>最近一次用户请求</h3><p>{request?.summary.trim() || '未提供用户请求：数据源尚未提供摘要。'}</p><span>请求时间：<time dateTime={request?.receivedAt}>{displayTime(request?.receivedAt ?? null)}</time></span></div><p className="fine-print">这里只展示用户提出的请求，不用 Agent 回复或活动事件冒充摘要。</p></section>
        <section className="info-card"><span className="eyebrow">VISUAL PROTOTYPE</span><h2>先搭骨架，再精修动作</h2><p>当前角色始终播放待机参考，不用动画假装工作状态。高分辨率像素风素材仍有轻微轮廓变化，并非已锁定像素的游戏精灵。</p></section>
        <section className="asset-links"><h2>已确认的原始素材</h2><a href={asset('standing-v2.png')} download>透明站姿底图 <span>PNG ↗</span></a><a href={asset('idle-preview-v2.gif')} download>待机循环预览 <span>GIF ↗</span></a><a href={asset('idle-frames-v2.png')} download>透明四帧图集 <span>PNG ↗</span></a></section>
      </aside>
    </div><footer>React + TypeScript · DOM/CSS 场景原型 · {modeLabel}<br/>渲染层只消费规范化数据；实际服务连接与认证应位于 Node / Electron 主进程。</footer>
  </main>;
}
