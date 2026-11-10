import { DEFAULT_NIGHT_REST, isNightRestTime, parseNightRestConfig } from './nightRest';
import type { NightRestConfig } from './nightRest';
import { personalAssets, personalAssetsReady } from './personalIdle';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeSnapshot } from './core';
import { displayStatus, freshness } from './core';
import { validateResidentTopology as validateTopology, residentSeatReport as liveOfficeSeatReport, bindResidentOffice as bindOffice } from './residentLayout';
import type { ResidentOfficeTopology as OfficeTopology, ResidentOfficeConfig as OfficeConfig } from './residentLayout';
import { residentPersona, nightRestPersona } from './residentVisuals';
import type { OfficePresentation } from './residentVisuals';
import { demoCharacters } from './demoAssets';
import type { DemoCharacter } from './demoAssets';
import { WholeOfficeScene } from './WholeOfficeScene';
import { liveOfficeSeats } from './liveOfficeSeats';
import { liveOfficePose, liveStatusLabels } from './liveOfficeMotion';
import { useLiveOfficeMotion } from './useLiveOfficeMotion';
import { detectModelSwitches } from './modelSwitch';
import type { ModelSwitchMark, ModelSwitchObservation, ModelSwitchRecord } from './modelSwitch';
import './live-office.css';
import { AgentDialog } from './AgentDialog';
import { OverflowAgents } from './OverflowAgents';
import { demoAssetUrl } from './assetUrl';

const systemWallClock = () => new Date();
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
  nightRestConfig?: NightRestConfig;
  /** Injectable local wall clock; does not alter source timestamps/freshness. */
  wallClock?: () => Date;
  wallClockLabel?: string;
}

/** Real normalized DTOs drive the approved full office, independently of the scripted demo. */
export function LiveOffice({ adapterFactory, officeConfig, topology: fixedTopology, modeLabel = '规范化数据源', characters = demoCharacters, nightRestConfig = DEFAULT_NIGHT_REST, wallClock = systemWallClock, wallClockLabel = '本机时间' }: LiveOfficeProps) {
  if (Boolean(officeConfig) === Boolean(fixedTopology)) throw new Error('Provide exactly one officeConfig or topology');
  const configuredNight = parseNightRestConfig(nightRestConfig);
  const [nightOverride, setNightOverride] = useState<NightRestConfig | null>(null);
  const nightConfig = nightOverride ?? configuredNight;
  const [enabled, setEnabled] = useState(true);
  const [retry, setRetry] = useState(0);
  const sourceKey = useMemo(() => ({ adapterFactory, retry }), [adapterFactory, retry]);
  const [received, setReceived] = useState<{ key: unknown; state: AdapterState; at: number }>({ key: sourceKey, state: initialState, at: 0 });
  const [now, setNow] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [modelSwitches, setModelSwitches] = useState<Record<string, ModelSwitchRecord>>({});
  const modelMarks = useRef<Map<string, ModelSwitchMark>>(new Map());
  const modelToken = useRef(0);
  const [assets, setAssets] = useState<{ key: unknown; ready: boolean; failed: string[]; loaded: string[] }>({ key: characters, ready: false, failed: [], loaded: [] });

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

  const state = received.key === sourceKey ? received.state : initialState;
  const elapsed = Math.max(0, now - received.at);
  const bound = useMemo(() => officeConfig ? bindOffice(officeConfig, state.snapshot ?? emptySnapshot) : null, [officeConfig, state.snapshot]);
  const topology = bound?.topology ?? fixedTopology!;
  validateTopology(topology);
  const snapshot = bound?.snapshot ?? state.snapshot;
  const observedAgents = snapshot?.agents ?? [];
  const visiblePersonas = [...new Set(observedAgents.filter(agent => agent.sourceFreshness === 'fresh').map(agent => residentPersona(agent.id, agent.character, topology)))].sort().join(',');
  const assetCache = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    const failed = new Set<string>();
    const selectedCharacters = characters.filter(character => visiblePersonas.split(',').includes(character.id));
    const required = selectedCharacters.map(character => character.seated.src);
    const publish = () => { if (alive) setAssets({ key: characters, ready: required.every(src => assetCache.current.has(src)), failed: [...failed], loaded: [...assetCache.current] }); };
    const load = (src: string, priority: 'high' | 'low') => new Promise<void>(resolve => {
      if (assetCache.current.has(src)) { resolve(); return; }
      const image = new Image();
      image.fetchPriority = priority;
      image.onload = () => { assetCache.current.add(src); publish(); resolve(); };
      image.onerror = () => { failed.add(src); publish(); resolve(); };
      image.src = demoAssetUrl(src);
    });
    publish();
    void Promise.all(required.map(src => load(src, 'high'))).then(async () => {
      // No background animation atlas competes with first-paint seated artwork.
      for (const character of selectedCharacters) {
        if (!alive) return;
        await load(character.locomotion.src, 'low');
        for (const src of [...personalAssets(character), ...(character.sleep ? [character.sleep.src] : []), ...(character.tablet ? [character.tablet.src] : [])]) {
          if (!alive) return;
          await load(src, 'low');
        }
      }
    });
    return () => { alive = false; };
  }, [characters, visiblePersonas, loadAttempt]);
  // Cache presentation only, never a request, status, or timestamp. Missing rows stay uncertain.
  const presentationCache = useRef<{ key: unknown; agents: Map<string, OfficePresentation> }>({ key: sourceKey, agents: new Map() });
  const presentation = new Map(received.key === sourceKey && presentationCache.current.key === sourceKey ? presentationCache.current.agents : []);
  if (officeConfig && bound) {
    const logicalIds = [officeConfig.office.selfSeatId, ...officeConfig.office.childSeatIds, ...officeConfig.office.team.memberSeatIds, ...[officeConfig.office.githubSeatId, officeConfig.office.devopsSeatId, officeConfig.office.hotspotSeatId].filter((id): id is string => id !== undefined)];
    const actualIds = [topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds, ...[topology.githubAgentId, topology.devopsAgentId, topology.hotspotAgentId].filter((id): id is string => id !== undefined)];
    logicalIds.forEach((logicalId, index) => {
      const configured = officeConfig.seats.find(seat => seat.id === logicalId)!;
      presentation.set(actualIds[index], { id: actualIds[index], name: configured.name, character: residentPersona(actualIds[index], configured.character, topology) });
    });
  }
  for (const agent of observedAgents) presentation.set(agent.id, { id: agent.id, name: agent.name, character: residentPersona(agent.id, agent.character, topology) });
  const ids = [topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds, ...[topology.githubAgentId, topology.devopsAgentId, topology.hotspotAgentId].filter((id): id is string => id !== undefined)];
  for (const id of presentation.keys()) if (!ids.includes(id)) presentation.delete(id);
  useEffect(() => { presentationCache.current = { key: sourceKey, agents: presentation }; }, [snapshot, sourceKey, topology]);
  // Provider/model changes keep the same instance seated. Detect them against
  // the displayed persona (explicit config may pin it) and let the scene cross-fade.
  const modelObservations: ModelSwitchObservation[] = observedAgents.map(agent => {
    const provider = agent.provider?.trim() || null;
    const model = agent.model?.trim() || null;
    const signature = provider && model ? `${provider} / ${model}` : provider ?? model;
    return { id: agent.id, identityKey: identityKey(agent), model: signature, character: presentation.get(agent.id)?.character ?? agent.character };
  });
  const modelSignature = JSON.stringify(modelObservations);
  useEffect(() => {
    const scan = detectModelSwitches(modelMarks.current, modelObservations, { at: window.performance.now(), nextToken: () => ++modelToken.current });
    modelMarks.current = scan.marks;
    if (Object.keys(scan.changes).length > 0) setModelSwitches(previous => ({ ...previous, ...scan.changes }));
  }, [modelSignature]);
  const visibleModelSwitches: Record<string, ModelSwitchRecord> = reducedMotion ? {} : Object.fromEntries(Object.entries(modelSwitches).filter(([, item]) => now - item.at < 1900));
  const seats = liveOfficeSeats(topology, [...presentation.values()]);
  const allocation = liveOfficeSeatReport(topology);
  const overflowTargets = [...allocation.childOverflowIds, ...allocation.teamOverflowIds].flatMap(id => {
    const agent = observedAgents.find(item => item.id === id);
    if (!agent || agent.status === 'offline') return [];
    return [{ id, identityKey: identityKey(agent), name: agent.name,
      persona: residentPersona(id, agent.character, topology), status: displayStatus(agent, elapsed, state.phase) }];
  });
  const nightTime = isNightRestTime(wallClock(), nightConfig);
  const targets = seats.filter(seat => !seat.empty).map(seat => {
    const agent = observedAgents.find(item => item.id === seat.id);
    const personalRole = seat.kind === 'owner' && seat.persona === 'self' ? 'self' as const : seat.kind === 'github' && seat.persona === 'github' ? 'github' as const : undefined;
    const sleepPersona = nightRestPersona(seat);
    const nightRest = Boolean(sleepPersona && nightTime);
    const nightArtReady = characters.some(item => item.id === sleepPersona && item.sleep && assets.key === characters && assets.loaded.includes(item.sleep.src));
    const nightEligible = Boolean(!state.error && nightRest && agent && displayStatus(agent, elapsed, state.phase) === 'idle' && nightArtReady);
    const nightArtKey = JSON.stringify([sleepPersona, characters.find(item => item.id === sleepPersona)?.sleep?.src]);
    return { nightRest, nightEligible, nightArtReady, nightArtKey, personalRole: !state.error && personalRole && characters.some(item => item.id === personalRole && personalAssetsReady(item, assets.loaded)) ? personalRole : undefined, id: seat.id, identityKey: agent ? identityKey(agent) : null, seatKey: JSON.stringify([seat.geometryId, seat.x, seat.y, seat.scale, seat.mirrored]), status: agent ? displayStatus(agent, elapsed, state.phase) : 'unknown' as const };
  });
  const assetsReady = assets.key === characters && assets.ready;
  const actors = useLiveOfficeMotion(targets, { sourceKey, reducedMotion, paused, assetsReady: true, hydrateSeated: true });
  // An admitted pickup owns its loaded artwork as well as the physical prop.
  // Replacing/failing optional atlases cannot turn a held scythe into another pose.
  const retainedSelfArt = useRef<DemoCharacter | undefined>(characters.find(item => item.id === 'self'));
  const selfPersonal = actors.some(actor => actor.personalRole === 'self' && actor.phase === 'personal');
  if (!selfPersonal) retainedSelfArt.current = characters.find(item => item.id === 'self');
  const visualCharacters = selfPersonal && retainedSelfArt.current
    ? [...characters.filter(item => item.id !== 'self'), retainedSelfArt.current] : characters;
  const retainedOwner = actors.find(actor => actor.visualOnly && actor.personalRole === 'self');
  const visualSeats = retainedOwner ? seats.map(seat => seat.kind === 'owner' ? { ...seat, id: retainedOwner.id, persona: 'self' as const, empty: false } : seat) : seats;
  const selectedId = selected ?? topology.selfAgentId;
  const currentAgent = observedAgents.find(agent => agent.id === selectedId);
  const effectiveStatus = currentAgent ? displayStatus(currentAgent, elapsed, state.phase) : 'unknown';
  const task = currentAgent?.task;
  const leaderLabel = seats.find(seat => seat.isLeader)?.label ?? '未绑定';
  const activeWorking = targets.filter(target => target.status === 'working').length;
  const uncertain = targets.filter(target => target.status === 'unknown').length;
  return <section className="whole-office-demo live-office" aria-labelledby="live-office-title" data-live-office="true" data-live-paused={paused} data-office-layout="fixed-office" data-office-assets-ready={assetsReady} data-office-reduced-motion={reducedMotion}>
    <h1 id="live-office-title" className="sr-only">状态办公室</h1>
    <div className="wo-toolbar"><div className="live-connection" role="status">{modeLabel} · {phaseLabels[state.phase]}</div><div className="live-actions"><button onClick={() => setEnabled(value => !value)}>{enabled ? '断开数据源' : '连接数据源'}</button><button onClick={() => { setEnabled(true); setRetry(value => value + 1); }}>重新连接</button><button disabled={reducedMotion} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{reducedMotion ? '系统偏好：减少动态' : paused ? '继续状态动画' : '暂停状态动画'}</button></div></div>
    <details className="live-night-settings"><summary>夜间休息 · {nightConfig.start}–{nightConfig.end} · {wallClockLabel}</summary><label><input aria-label="启用夜间空闲休息" type="checkbox" checked={nightConfig.enabled} onChange={event => setNightOverride({ ...nightConfig, enabled: event.target.checked })} />空闲时伏桌休息</label>{(['start', 'end'] as const).map(key => <label key={key}>{key === 'start' ? '开始' : '结束'}<input aria-label={key === 'start' ? '夜间休息开始时间' : '夜间休息结束时间'} type="time" value={nightConfig[key]} onChange={event => { try { setNightOverride(parseNightRestConfig({ ...nightConfig, [key]: event.target.value })); } catch { /* Keep the last valid window. */ } }} /></label>)}</details>
    {state.error && <p className="live-warning" role="alert">{state.error}</p>}
    {state.phase !== 'connected' && <p className="live-warning" role="status">数据源{phaseLabels[state.phase]}。未知状态不表示离线，也不会继续显示工作动作。</p>}
    {snapshot?.coverage && <p className="live-warning">覆盖范围：{snapshot.coverage}</p>}
    {bound && bound.warnings.length > 0 && <details className="live-binding-warnings"><summary>{bound.warnings.length} 个席位未能安全绑定</summary><ul>{bound.warnings.map(warning => <li key={warning.seatId}>{warning.seatId}：{warning.message}</li>)}</ul></details>}
    <WholeOfficeScene layout={topology.team.layout} seats={visualSeats} characters={visualCharacters} canAnimate assetReady={src => assets.loaded.includes(src)} reducedMotion={reducedMotion} childCount={topology.childAgentIds.length} live selectedId={selectedId} onSelect={setSelected} leaderLabel={leaderLabel} floorLabel={`${activeWorking} 个工作中`} floorStatus={uncertain ? `${uncertain} 个状态未知` : phaseLabels[state.phase]} working={activeWorking > 0} modelSwitchForSeat={seat => {
      const record = visibleModelSwitches[seat.id];
      return record ? { key: String(record.token), fromPersona: record.fromCharacter, toCharacter: record.toCharacter } : null;
    }} collaborationLabelForSeats={tableSeats => {
      const members = tableSeats.map(seat => observedAgents.find(agent => agent.id === seat.id)).filter(agent => agent?.collaboration?.group);
      const groups = [...new Set(members.map(agent => agent!.collaboration!.group))];
      if (groups.length !== 1) return null;
      const stale = members.some(agent => displayStatus(agent!, elapsed, state.phase) === 'unknown');
      return `${groups[0]} · ${members.length} 位协作 PI${stale ? ' · 最后观察' : ''}`;
    }} screenForSeat={seat => {
      const agent = observedAgents.find(item => item.id === seat.id);
      const status = agent ? displayStatus(agent, elapsed, state.phase) : 'unknown';
      // Retained offline rows are history, not an occupied computer. Clear on explicit
      // exit without waiting for the departure animation or collector retention TTL.
      if (agent?.status === 'offline') return null;
      const task = agent?.task?.name?.trim() || null;
      const repository = agent?.repo?.trim() || null;
      return task || repository ? { task, repository, stale: status === 'unknown' } : null;
    }} statusForSeat={seat => { const target = targets.find(item => item.id === seat.id); const retained = actors.find(item => item.id === seat.id)?.visualOnly; return { status: retained ? 'unknown' : target?.status ?? 'unknown', label: !retained && target?.identityKey ? liveStatusLabels[target.status] : '状态未知 · 未收到数据' }; }} poseForSeat={seat => {
      const actor = actors.find(item => item.id === seat.id);
      return actor ? liveOfficePose(actor, reducedMotion) : null;
    }} worldChildren={<OverflowAgents targets={overflowTargets} characters={characters} paused={paused} reducedMotion={reducedMotion} sourceKey={sourceKey} assetReady={src => assets.loaded.includes(src)} onSelect={setSelected} />} loading={assets.failed.length > 0 && <button className="live-asset-retry" onClick={() => setLoadAttempt(value => value + 1)}>部分素材未载入，点击重试</button>} />
    {selected !== null && <AgentDialog onClose={() => setSelected(null)}>
      <section className="live-inspector" aria-labelledby="live-details-title"><div><h2 id="live-details-title">{currentAgent?.name ?? presentation.get(selectedId)?.name ?? selectedId}</h2></div><dl>
        <div><dt>当前显示状态</dt><dd data-live-current-status={effectiveStatus}>{liveStatusLabels[effectiveStatus]}</dd></div>
        <div><dt>来源报告状态</dt><dd>{currentAgent ? liveStatusLabels[currentAgent.status] : '未收到该 Agent 数据'}</dd></div>
        <div><dt>数据来源</dt><dd>{currentAgent?.sourceLabel || currentAgent?.source || '未提供'}</dd></div>
        {currentAgent?.collaboration && <div><dt>协作 PI · 组名</dt><dd>{currentAgent.collaboration.group ?? '尚未上报分组'}</dd></div>}
        <div><dt>连接状态</dt><dd>{phaseLabels[state.phase]}</dd></div>
        <div><dt>状态新鲜度</dt><dd data-live-freshness>{currentAgent ? freshnessLabels[freshness(currentAgent, elapsed)] : '未知'}</dd></div>
        <div><dt>状态观测时间</dt><dd><time dateTime={currentAgent?.observedAt ?? undefined}>{timeLabel(currentAgent?.observedAt)}</time></dd></div>
      </dl><div className="live-request">{task?.name?.trim() && <p>{task.name}</p>}{currentAgent?.repo && <span>仓库：{currentAgent.repo}</span>}{task?.type && <span>任务类型：{task.type}</span>}{task?.detail && <span>阶段／说明：{task.detail}</span>}{task?.startedAt && <span>开始时间：<time dateTime={task.startedAt}>{timeLabel(task.startedAt)}</time></span>}{(currentAgent?.provider || currentAgent?.model) && <span key={[currentAgent.provider ?? '', currentAgent.model ?? ''].join('\u0000')} className="live-model-value" data-live-model={[currentAgent.provider, currentAgent.model].filter(Boolean).join(' / ')} data-live-model-switching={visibleModelSwitches[selectedId] ? 'true' : undefined}>选定模型：{[currentAgent.provider, currentAgent.model].filter(Boolean).join(' / ')}</span>}{effectiveStatus === 'unknown' && task?.name && <span>以上为最后观察信息，不代表当前仍在执行。</span>}</div></section></AgentDialog>}
  </section>;
}
