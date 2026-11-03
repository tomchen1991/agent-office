import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeTopology } from './core';
import { freshness, validateTopology, displayStatus, MAX_VISIBLE_CHILD_AGENTS } from './core';
import { createMockAdapter, demoTopology } from './mock';
import { useOfficeMotion } from './useOfficeMotion';
import type { MotionActor, MotionTarget } from './motion';
import { retainedDepartureIds } from './motion';
import { selfMotionSlots } from './motionSlots';

const asset = (file: string) => `${import.meta.env.BASE_URL}assets/self-agent/${file}`;
const selfSlots = selfMotionSlots(import.meta.env.BASE_URL);
const statusLabels = { idle: '待机', working: '工作中', waiting: '等待输入', stopping: '停止中', offline: '离线', unknown: '状态未知' };
const freshnessLabels = { fresh: '新鲜', stale: '已过期', unknown: '未知' };
const phaseLabels = { connecting: '连接中', connected: '已连接', disconnected: '已断开' };
function displayTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未知';
  return new Date(value).toLocaleString('zh-CN');
}

type Presentation = { id: string; name: string; character: OfficeAgent['character'] };
function AgentSeat({ agent, presentation, id, label, playing, selected, onSelect, actor }: {
  actor?: MotionActor; presentation?: Presentation; agent?: OfficeAgent; id: string; label: string; playing: boolean; selected: boolean; onSelect: (id: string) => void;
}) {
  const slot = selfSlots[actor?.phase === 'arriving' ? 'arrival' : actor?.phase === 'moving' ? 'move' : actor?.phase === 'leaving' ? 'departure' : agent?.status === 'idle' ? 'idle' : agent?.status === 'working' ? 'active' : agent?.status === 'stopping' ? 'stopping' : 'unknown'];
  const imageSource = playing && actor?.phase !== 'leaving' && slot.animatedSource ? slot.animatedSource : slot.staticSource;
  const character = agent?.character ?? presentation?.character;
  const name = agent?.name ?? presentation?.name ?? id;
  return <button className={`agent-seat ${selected ? 'selected' : ''}`} onClick={() => onSelect(id)} aria-pressed={selected} aria-label={`${name}，${label}，查看详情`}>
    <span className="desk-role">{label}</span>
    {actor ? <span className={`motion-avatar phase-${actor.phase}`} style={{ transform: `translate(${actor.phase === 'leaving' ? actor.progress * -28 : (1 - actor.progress) * (actor.phase === 'arriving' ? -28 : actor.phase === 'moving' ? 20 : 0)}px, ${(1 - actor.progress) * (actor.phase === 'arriving' ? 10 : 0)}px)`, opacity: actor.phase === 'leaving' ? 1 - actor.progress : 1 }}>
    {actor.phase === 'arriving' && <span className="arrival-label">入口 → 工位</span>}
    {character === 'self'
      ? <img className="avatar self-avatar" src={imageSource} alt={`紫发双马尾与星月镰刀的自研 Agent；${slot.description}`} />
      : <span className={`avatar placeholder ${character ?? 'unknown'}`}><span aria-hidden="true">{character === 'deepseek' ? 'D' : character === 'chatgpt' ? 'C' : character === 'grok' ? 'G' : '?'}</span><small>占位形象</small></span>}
    </span> : <span className="avatar empty-avatar"><small>{agent ? '等待入场' : '空工位 · 占位形象'}</small></span>}
    <span className="desk-top"><strong>{name}</strong><span className={`agent-status ${agent?.status ?? 'unknown'}`}>{actor?.phase === 'leaving' ? '离场 · 无当前数据' : agent ? statusLabels[agent.status] : '未收到数据'}</span></span>
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
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mockStatus, setMockStatus] = useState<'idle' | 'working' | 'stopping'>('idle');
  const [hideSelf, setHideSelf] = useState(false);
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
    setReducedMotion(media.matches);
    const change = () => { setPlaying(!media.matches); setReducedMotion(media.matches); };
    media.addEventListener('change', change);
    const timer = window.setInterval(() => setElapsed(performance.now() - receivedAt.current), 5000);
    return () => { media.removeEventListener('change', change); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    setLayout(topology.team.layout);
    setSelected(topology.selfAgentId);
  }, [topology]);
  const agents = (state.snapshot?.agents ?? [])
    .filter(agent => !(isDefaultMock && hideSelf && agent.id === topology.selfAgentId))
    .map(agent => {
      const effective = isDefaultMock && agent.id === topology.selfAgentId ? {...agent, status: mockStatus} : agent;
      return {...effective, status: displayStatus(effective, elapsed, state.phase)};
    });
  const agent = agents.find(item => item.id === selected);
  const childIds = topology.childAgentIds.slice(0, MAX_VISIBLE_CHILD_AGENTS);
  const overflow = Math.max(0, topology.childAgentIds.length - MAX_VISIBLE_CHILD_AGENTS);
  const slots = [
    { id: topology.selfAgentId, seat: 'owner' },
    ...childIds.map((id, index) => ({ id, seat: `child-${index}` })),
    ...topology.team.memberIds.map((id, index) => ({ id, seat: `team-${layout}-${index}` })),
  ];
  const targets: MotionTarget[] = slots.flatMap(slot => {
    const present = agents.find(item => item.id === slot.id);
    return present ? [{ ...slot, status: present.status }] : [];
  });
  const sourceKey = useMemo(() => ({ adapterFactory, retry, enabled }), [adapterFactory, retry, enabled]);
  const presentationCache = useRef<{ key: unknown; entries: Map<string, Presentation> }>({ key: sourceKey, entries: new Map() });
  // Derive during render, commit only after React accepts this render.
  const presentationEntries = new Map(presentationCache.current.key === sourceKey ? presentationCache.current.entries : []);
  for (const item of agents) presentationEntries.set(item.id, { id: item.id, name: item.name, character: item.character });
  const actors = useOfficeMotion(targets, { paused: !playing, reducedMotion, connected: state.phase === 'connected', sourceKey });
  useEffect(() => {
    const keep = new Set([...agents.map(item => item.id), ...actors.map(item => item.id)]);
    const entries = new Map(presentationEntries);
    for (const id of entries.keys()) if (!keep.has(id)) entries.delete(id);
    presentationCache.current = { key: sourceKey, entries };
  }, [actors, state.snapshot, hideSelf, sourceKey]);
  const retainedIds = retainedDepartureIds(actors, slots.map(slot => slot.seat), targets.map(target => target.seat));
  const retainedAtSeat = (actor: MotionActor) => retainedIds.has(actor.id);
  const seat = (id: string, label: string) => {
    const slot = slots.find(item => item.id === id);
    const actor = actors.find(item => item.id === id && item.phase !== 'leaving') ?? actors.find(item => item.seat === slot?.seat && retainedAtSeat(item));
    const actorId = actor?.id ?? id;
    return <AgentSeat key={id} id={actorId} label={label} actor={actor} presentation={presentationEntries.get(actorId)} agent={actors.some(item => item.id === actorId && item.phase === 'leaving') ? undefined : agents.find(item => item.id === actorId)} playing={playing && !reducedMotion && state.phase === 'connected'} selected={selected === actorId} onSelect={setSelected} />;
  };
  const request = agent?.latestUserRequest;
  return <main>
    <h1 className="sr-only">数据详情</h1>
    <section className="toolbar" aria-label="预览设置">
      <div className="connection" role="status"><span className={`connection-dot ${state.phase}`} aria-hidden="true" />{modeLabel} · {phaseLabels[state.phase]}</div>
      <div className="toolbar-actions"><button onClick={() => setEnabled(!enabled)}>{enabled ? '断开数据源' : '连接数据源'}</button><button onClick={() => { setEnabled(true); setRetry(value => value + 1); }}>重新连接</button><button aria-pressed={playing && !reducedMotion} disabled={reducedMotion} onClick={() => setPlaying(!playing)}>{reducedMotion ? '系统偏好：减少动态' : playing ? '暂停全部动画' : '播放全部动画'}</button></div>
    </section>
    {isDefaultMock && <section className="mock-scenarios" aria-label="模拟状态场景"><strong>模拟自研 Agent</strong>{(['idle', 'working', 'stopping'] as const).map(status => <button key={status} aria-pressed={mockStatus === status} onClick={() => setMockStatus(status)}>{statusLabels[status]}</button>)}<button aria-pressed={hideSelf} onClick={() => setHideSelf(value => !value)}>{hideSelf ? '重新入场' : '离场演示'}</button></section>}
    {state.snapshot?.coverage && <p className="warning" role="status">数据覆盖范围：{state.snapshot.coverage}</p>}
    {state.error && <p className="warning" role="alert">连接异常：{state.error}。可尝试重新连接。</p>}
    {state.phase === 'disconnected' && <p className="warning" role="status">数据源已断开。保留的画面不是实时状态；时间继续计算，过期后会标记。</p>}
    <div className="layout">
      <section className="office-scene" aria-label="Agent 办公室">
        <section className="private-office" aria-labelledby="private-title"><div className="room-heading"><h3 id="private-title">自研 Agent · 独立办公室</h3></div><div className="private-seats"><div className="owner-desk">{seat(topology.selfAgentId, '自研 Agent')}</div><div className="child-area"><span className="area-caption">子 Agent 独立工位</span><div className="child-seats">{childIds.map((id, index) => seat(id, `子 Agent ${index + 1}`))}{overflow > 0 && <span className="overflow" aria-label={`另有 ${overflow} 个子 Agent 未展示`}>+{overflow}</span>}{childIds.length === 0 && <p className="empty-state">暂未配置子 Agent</p>}</div></div></div></section>
        <section className={`team-office ${layout}`} aria-labelledby="team-title"><div className="room-heading"><h3 id="team-title">公共协作区</h3><fieldset className="layout-picker"><legend className="sr-only">展示拓扑配置</legend><label><input type="radio" name="layout" checked={layout === 'independent-desks'} onChange={() => setLayout('independent-desks')} />独立工位</label><label><input type="radio" name="layout" checked={layout === 'leader-desks'} onChange={() => setLayout('leader-desks')} />主从工位</label><label><input type="radio" name="layout" checked={layout === 'peer-table'} onChange={() => setLayout('peer-table')} />平等协作</label></fieldset></div><div className="team-seats">{topology.team.memberIds.map(id => <div key={id} className={layout === 'leader-desks' && id === topology.team.leaderId ? 'leader-seat' : ''}>{seat(id, layout === 'leader-desks' ? (id === topology.team.leaderId ? '团队负责人' : '协作成员') : '平等成员')}</div>)}</div>{layout === 'peer-table' && <div className="shared-table" aria-hidden="true">共享协作桌</div>}</section>
        <div className="exit-lane" aria-label="离场通道"><span>出口 ←</span>{actors.filter(actor => actor.phase === 'leaving' && !retainedAtSeat(actor)).map(actor => <span key={actor.id} className="exit-silhouette"><AgentSeat id={actor.id} actor={actor} presentation={presentationEntries.get(actor.id)} label="离场通道" playing={false} selected={selected === actor.id} onSelect={setSelected} /></span>)}</div>
      </section>
      <aside>
        <section className="info-card request-card" aria-labelledby="details-title"><h2 id="details-title">{agent?.name ?? selected}</h2><span className="mock-label">{isDefaultMock ? `${modeLabel} / 非真实采集` : modeLabel}</span><dl><div><dt>最近观测状态</dt><dd>{agent ? statusLabels[agent.status] : '未知：未收到该 Agent 数据'}</dd></div><div><dt>数据来源</dt><dd>{agent?.source || '未知'}</dd></div><div><dt>连接状态</dt><dd>{phaseLabels[state.phase]}</dd></div><div><dt>状态新鲜度</dt><dd>{agent ? freshnessLabels[freshness(agent, elapsed)] : '未知'}</dd></div><div><dt>状态观测时间</dt><dd><time dateTime={agent?.observedAt ?? undefined}>{displayTime(agent?.observedAt ?? null)}</time></dd></div></dl><div className="request-body"><h3>最近一次用户请求</h3><p>{request?.summary.trim() || '未提供用户请求：数据源尚未提供摘要。'}</p><span>请求时间：<time dateTime={request?.receivedAt}>{displayTime(request?.receivedAt ?? null)}</time></span><span>摘要来源：{request?.source ?? (isDefaultMock && request ? 'mock' : '未提供')}</span></div></section>
        <section className="asset-links"><h2>角色素材</h2><a href={asset('standing-v2.png')} download>透明站姿底图 <span>PNG ↗</span></a><a href={asset('idle-preview-v2.gif')} download>待机循环预览 <span>GIF ↗</span></a><a href={asset('idle-frames-v2.png')} download>透明四帧图集 <span>PNG ↗</span></a></section>
      </aside>
    </div>
  </main>;
}
