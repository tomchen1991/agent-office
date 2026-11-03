import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeSnapshot, OfficeTopology } from './core';
import { displayStatus, freshness, validateTopology } from './core';
import { bindOffice } from './binding';
import type { OfficeConfig } from './config';
import { demoCharacters } from './demoAssets';
import type { DemoCharacter } from './demoAssets';
import { WholeOfficeScene } from './WholeOfficeScene';
import { liveOfficeSeats } from './liveOfficeSeats';
import { liveOfficePose, liveStatusLabels } from './liveOfficeMotion';
import { useLiveOfficeMotion } from './useLiveOfficeMotion';
import './live-office.css';

const emptySnapshot: OfficeSnapshot = { agents: [], receivedAt: '', identityCoverage: 'unknown' };
const initialState: AdapterState = { phase: 'connecting', snapshot: null, error: null };
const phaseLabels = { connecting: '连接中', connected: '已连接', disconnected: '已断开' };
const freshnessLabels = { fresh: '新鲜', stale: '已过期', unknown: '未知' };
const timeLabel = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未提供时间';
const identityKey = (agent: OfficeAgent) => JSON.stringify([agent.id, agent.identity?.sourceId, agent.identity?.instanceId, agent.identity?.collectorEpoch]);

export interface LiveOfficeProps {
  adapterFactory: () => OfficeAdapter;
  /** Supply one of officeConfig (recommended for epoch rebinding) or already-bound topology. */
  officeConfig?: OfficeConfig;
  topology?: OfficeTopology;
  modeLabel?: string;
  characters?: readonly DemoCharacter[];
}

/** Real normalized DTOs drive the approved full office, independently of the scripted demo. */
export function LiveOffice({ adapterFactory, officeConfig, topology: fixedTopology, modeLabel = '规范化数据源', characters = demoCharacters }: LiveOfficeProps) {
  if (Boolean(officeConfig) === Boolean(fixedTopology)) throw new Error('Provide exactly one officeConfig or topology');
  const [enabled, setEnabled] = useState(true);
  const [retry, setRetry] = useState(0);
  const sourceKey = useMemo(() => ({ adapterFactory, retry }), [adapterFactory, retry]);
  const [received, setReceived] = useState<{ key: unknown; state: AdapterState; at: number }>({ key: sourceKey, state: initialState, at: 0 });
  const [now, setNow] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [assets, setAssets] = useState<{ key: unknown; ready: boolean; failed: string[] }>({ key: characters, ready: false, failed: [] });

  useEffect(() => {
    if (!enabled) {
      setReceived(previous => ({ key: sourceKey, state: { ...(previous.key === sourceKey ? previous.state : initialState), phase: 'disconnected', error: null }, at: previous.key === sourceKey ? previous.at : window.performance.now() }));
      return;
    }
    let alive = true;
    let previousSnapshot: OfficeSnapshot | null = null;
    let receipt = window.performance.now();
    let adapter: OfficeAdapter | undefined;
    let unsubscribe: (() => void) | undefined;
    const release = () => {
      alive = false;
      unsubscribe?.(); unsubscribe = undefined;
      adapter?.dispose(); adapter = undefined;
    };
    try {
      adapter = adapterFactory();
      unsubscribe = adapter.subscribe(state => {
        if (!alive) return;
        if (state.snapshot !== previousSnapshot) { previousSnapshot = state.snapshot; receipt = window.performance.now(); }
        setReceived({ key: sourceKey, state, at: receipt });
        setNow(window.performance.now());
      });
      adapter.connect();
    } catch {
      release();
      setReceived({ key: sourceKey, state: { ...initialState, phase: 'disconnected', error: '数据源连接失败' }, at: receipt });
    }
    return release;
  }, [sourceKey, adapterFactory, enabled]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(media.matches);
    apply(); media.addEventListener('change', apply);
    // Freshness keeps advancing when motion is paused or the tab has no active RAF.
    const timer = window.setInterval(() => setNow(window.performance.now()), 250);
    return () => { media.removeEventListener('change', apply); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let alive = true;
    const loaded = new Set<string>(), failed = new Set<string>();
    const sources = [...new Set(characters.flatMap(character => [character.locomotion.src, character.seated.src]))];
    setAssets({ key: characters, ready: sources.length === 0, failed: [] });
    const images = sources.map(src => {
      const image = new Image();
      const publish = () => { if (alive) setAssets({ key: characters, ready: loaded.size === sources.length && !failed.size, failed: [...failed] }); };
      image.onload = () => { loaded.add(src); failed.delete(src); publish(); };
      image.onerror = () => { failed.add(src); publish(); };
      image.src = `${import.meta.env.BASE_URL}${src}`;
      return image;
    });
    return () => { alive = false; images.forEach(image => { image.onload = null; image.onerror = null; }); };
  }, [characters, loadAttempt]);

  const state = received.key === sourceKey ? received.state : initialState;
  const elapsed = Math.max(0, now - received.at);
  const bound = useMemo(() => officeConfig ? bindOffice(officeConfig, state.snapshot ?? emptySnapshot) : null, [officeConfig, state.snapshot]);
  const topology = bound?.topology ?? fixedTopology!;
  validateTopology(topology);
  const snapshot = bound?.snapshot ?? state.snapshot;
  const observedAgents = snapshot?.agents ?? [];
  // Cache presentation only, never a request, status, or timestamp. Missing rows stay uncertain.
  const presentationCache = useRef<{ key: unknown; agents: Map<string, Pick<OfficeAgent, 'id' | 'name' | 'character'>> }>({ key: sourceKey, agents: new Map() });
  const presentation = new Map(received.key === sourceKey && presentationCache.current.key === sourceKey ? presentationCache.current.agents : []);
  if (officeConfig && bound) {
    const logicalIds = [officeConfig.office.selfSeatId, ...officeConfig.office.childSeatIds, ...officeConfig.office.team.memberSeatIds];
    const actualIds = [topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds];
    logicalIds.forEach((logicalId, index) => {
      const configured = officeConfig.seats.find(seat => seat.id === logicalId)!;
      presentation.set(actualIds[index], { id: actualIds[index], name: configured.name, character: configured.character });
    });
  }
  for (const agent of observedAgents) presentation.set(agent.id, { id: agent.id, name: agent.name, character: agent.character });
  const ids = [topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds];
  for (const id of presentation.keys()) if (!ids.includes(id)) presentation.delete(id);
  useEffect(() => { presentationCache.current = { key: sourceKey, agents: presentation }; }, [snapshot, sourceKey, topology]);
  const seats = liveOfficeSeats(topology, [...presentation.values()]);
  const targets = seats.map(seat => {
    const agent = observedAgents.find(item => item.id === seat.id);
    return { id: seat.id, identityKey: agent ? identityKey(agent) : null, seatKey: JSON.stringify([seat.geometryId, seat.x, seat.y, seat.scale, seat.mirrored]), status: agent ? displayStatus(agent, elapsed, state.phase) : 'unknown' as const };
  });
  const assetsReady = assets.key === characters && assets.ready;
  const actors = useLiveOfficeMotion(targets, { sourceKey, reducedMotion, paused, assetsReady });
  const selectedId = selected && ids.includes(selected) ? selected : topology.selfAgentId;
  const currentAgent = observedAgents.find(agent => agent.id === selectedId);
  const effectiveStatus = currentAgent ? displayStatus(currentAgent, elapsed, state.phase) : 'unknown';
  const request = currentAgent?.latestUserRequest;
  const leaderLabel = seats.find(seat => seat.isLeader)?.label ?? '未绑定';
  const activeWorking = targets.filter(target => target.status === 'working').length;
  const uncertain = targets.filter(target => target.status === 'unknown').length;
  return <section className="whole-office-demo live-office" aria-labelledby="live-office-title" data-live-office="true" data-office-layout={topology.team.layout} data-office-assets-ready={assetsReady} data-office-reduced-motion={reducedMotion}>
    <div className="wo-heading"><div><span className="wo-kicker">AGENT OFFICE / STATUS-DRIVEN STUDIO</span><h1 id="live-office-title">同一间办公室，跟随每个状态。</h1><p>只展示数据源明确给出的状态；用户请求、观测时间与数据新鲜度分开呈现。</p></div><span className="wo-demo-tag"><i />{modeLabel}</span></div>
    <div className="wo-toolbar"><div className="live-connection" role="status">{modeLabel} · {phaseLabels[state.phase]}</div><div className="live-actions"><button onClick={() => setEnabled(value => !value)}>{enabled ? '断开数据源' : '连接数据源'}</button><button onClick={() => { setEnabled(true); setRetry(value => value + 1); }}>重新连接</button><button disabled={reducedMotion} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{reducedMotion ? '系统偏好：减少动态' : paused ? '继续状态动画' : '暂停状态动画'}</button></div></div>
    {state.error && <p className="live-warning" role="alert">{state.error}</p>}
    {state.phase !== 'connected' && <p className="live-warning" role="status">数据源{phaseLabels[state.phase]}。未知状态不表示离线，也不会继续显示工作动作。</p>}
    {snapshot?.coverage && <p className="live-warning">覆盖范围：{snapshot.coverage}</p>}
    {bound && bound.warnings.length > 0 && <details className="live-binding-warnings"><summary>{bound.warnings.length} 个席位未能安全绑定</summary><ul>{bound.warnings.map(warning => <li key={warning.seatId}>{warning.seatId}：{warning.message}</li>)}</ul></details>}
    <WholeOfficeScene layout={topology.team.layout} seats={seats} characters={characters} canAnimate={assetsReady} reducedMotion={reducedMotion} childCount={topology.childAgentIds.length} live selectedId={selectedId} onSelect={setSelected} leaderLabel={leaderLabel} floorLabel={`${activeWorking} 个工作中`} floorStatus={uncertain ? `${uncertain} 个状态未知` : phaseLabels[state.phase]} working={activeWorking > 0} statusForSeat={seat => { const target = targets.find(item => item.id === seat.id)!; return { status: target.status, label: target.identityKey ? liveStatusLabels[target.status] : '状态未知 · 未收到数据' }; }} poseForSeat={seat => {
      const actor = actors.find(item => item.id === seat.id);
      return actor ? liveOfficePose(actor, reducedMotion) : null;
    }} loading={!assetsReady && <div className="wo-loading" role="status"><strong>{assets.failed.length ? '部分动作素材加载失败' : '正在载入办公室动作素材…'}</strong><span>数据状态仍正常显示；素材就绪后才播放动作。</span>{assets.failed.length > 0 && <button onClick={() => setLoadAttempt(value => value + 1)}>重新加载素材</button>}</div>} />
    {topology.team.memberIds.length > 3 && <p className="live-warning">协作区展示 3 个空间席位，另有 {topology.team.memberIds.length - 3} 位成员可在下方选择查看。</p>}
    <div className="live-details-layout"><nav className="live-agent-list" aria-label="选择 Agent 查看数据">{ids.map(id => <button key={id} aria-pressed={selectedId === id} onClick={() => setSelected(id)}>{presentation.get(id)?.name ?? id}</button>)}</nav>
      <section className="live-inspector" aria-labelledby="live-details-title"><div><span className="wo-kicker">AGENT INSPECTOR</span><h2 id="live-details-title">{currentAgent?.name ?? presentation.get(selectedId)?.name ?? selectedId}</h2></div><dl>
        <div><dt>当前显示状态</dt><dd data-live-current-status={effectiveStatus}>{liveStatusLabels[effectiveStatus]}</dd></div>
        <div><dt>来源报告状态</dt><dd>{currentAgent ? liveStatusLabels[currentAgent.status] : '未收到该 Agent 数据'}</dd></div>
        <div><dt>数据来源</dt><dd>{currentAgent?.source || '未提供'}</dd></div>
        <div><dt>连接状态</dt><dd>{phaseLabels[state.phase]}</dd></div>
        <div><dt>状态新鲜度</dt><dd data-live-freshness>{currentAgent ? freshnessLabels[freshness(currentAgent, elapsed)] : '未知'}</dd></div>
        <div><dt>状态观测时间</dt><dd><time dateTime={currentAgent?.observedAt ?? undefined}>{timeLabel(currentAgent?.observedAt)}</time></dd></div>
      </dl><div className="live-request"><h3>最近一次用户请求</h3><p>{request?.summary.trim() || '未提供用户请求摘要'}</p><span>请求时间：<time dateTime={request?.receivedAt}>{timeLabel(request?.receivedAt)}</time></span><span>摘要来源：{request?.source || '未提供'}</span></div></section></div>
    <p className="wo-footnote">工位、外观与团队负责人来自显式配置，自研专属办公室不自动获得领导角色。待机使用坐姿待机帧；停止中保持中性，不冒充错误。缺失条目、过期与断线不会触发退场；只有明确离线才播放起身与离场。这里只展示 DTO 的用户请求，不用 Agent 回复、活动事件或模型名补写。</p>
  </section>;
}
