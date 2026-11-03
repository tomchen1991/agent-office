import { useMemo, useState } from 'react';
import type { AdapterState, OfficeAdapter, OfficeAgent, OfficeStatus } from './core';
import type { OfficeConfig } from './config';
import { LiveOffice } from './LiveOffice';
import { liveStatusLabels } from './liveOfficeMotion';

/** Synthetic normalized contract fixtures only. No network, host discovery, or real tasks. */
export function createContractExampleSource() {
  let status: OfficeStatus = 'working', omitted = false, stale = false, epoch = 1;
  const subscribers = new Set<(state: AdapterState) => void>();
  const snapshot = (): AdapterState => {
    const receivedAt = new Date().toISOString();
    const personas = ['self', 'deepseek', 'chatgpt', 'grok', 'child-1', 'child-2', 'child-3', 'child-4', 'child-5', 'github'];
    const agents: OfficeAgent[] = personas.filter(id => !(omitted && id === 'self')).map(id => ({
      id: `synthetic:${id}:${epoch}`, name: id, character: 'unknown',
      identity: { sourceId: 'contract-example', instanceId: id, collectorEpoch: `example-epoch-${epoch}` },
      status: id === 'self' || id === 'github' ? status : id === 'chatgpt' ? 'waiting' : id === 'grok' ? 'stopping' : 'idle',
      sourceFreshness: stale ? 'stale' : 'fresh', validForMs: 60_000, observedAt: receivedAt, source: 'contract-example / 合成 DTO',
      latestUserRequest: id === 'self' ? { summary: '【合成 USER 请求】检查办公室里各个 Agent 的状态。', receivedAt, source: 'synthetic-user-fixture' } : null,
    }));
    return { phase: 'connected', error: null, snapshot: { agents, receivedAt, identityCoverage: omitted ? 'partial' : 'complete', coverage: omitted ? '合成覆盖不完整：缺失自研条目；本示例所有席位使用 follow-unique，无法证明 epoch 唯一，因此暂停全部自动绑定。缺失不等于离线。' : '合成完整快照，非真实采集' } };
  };
  const publish = () => { const state = snapshot(); subscribers.forEach(listener => listener(state)); };
  const adapterFactory = (): OfficeAdapter => {
    let active = false;
    const listeners = new Set<(state: AdapterState) => void>();
    const forward = (state: AdapterState) => { if (active) listeners.forEach(listener => listener(state)); };
    return {
      subscribe(listener) { listeners.add(listener); listener({ phase: active ? 'connected' : 'connecting', error: null, snapshot: active ? snapshot().snapshot : null }); return () => { listeners.delete(listener); }; },
      connect() { if (active) return; active = true; subscribers.add(forward); forward(snapshot()); },
      dispose() { active = false; subscribers.delete(forward); },
    };
  };
  return { adapterFactory,
    setStatus(next: OfficeStatus) { status = next; omitted = false; stale = false; publish(); },
    setMissing(next: boolean) { omitted = next; publish(); },
    setStale(next: boolean) { stale = next; publish(); },
    replaceEpoch() { epoch++; publish(); },
    refresh() { stale = false; publish(); },
  };
}
export function contractExampleConfig(layout: OfficeConfig['office']['team']['layout']): OfficeConfig {
  const names = ['自研 Agent', 'DeepSeek', 'ChatGPT', 'Grok', '子 Agent 1', '子 Agent 2', '子 Agent 3', '子 Agent 4', '子 Agent 5', 'Auto-fix'];
  const ids = ['self', 'deepseek', 'chatgpt', 'grok', 'child-1', 'child-2', 'child-3', 'child-4', 'child-5', 'github'];
  return { version: 1, seats: ids.map((id, index) => ({ id, name: names[index], character: id === 'github' ? 'github' : index < 4 ? (['self', 'deepseek', 'chatgpt', 'grok'] as const)[index] : 'self', selector: { sourceId: 'contract-example', instanceId: id, epoch: { policy: 'follow-unique' } } })),
    office: { selfSeatId: 'self', childSeatIds: ids.slice(4, 9), githubSeatId: 'github', team: { layout, memberSeatIds: ids.slice(1, 4), seatAssignments: { deepseek: 'public-table-1-seat-1', chatgpt: 'public-desk-1', grok: 'public-desk-2' }, ...(layout === 'leader-desks' ? { leaderSeatId: 'chatgpt' } : {}) } } };
}

export function LiveOfficeExample() {
  const source = useMemo(createContractExampleSource, []);
  const layout = 'independent-desks' as const;
  const [clock, setClock] = useState<'local' | 'day' | 'night'>('local');
  const wallClock = useMemo(() => () => { const date = new Date(); if (clock !== 'local') date.setHours(clock === 'night' ? 23 : 12, 0, 0, 0); return date; }, [clock]);
  const [status, setStatus] = useState<OfficeStatus>('working');
  const [missing, setMissing] = useState(false);
  const [stale, setStale] = useState(false);
  const officeConfig = useMemo(() => contractExampleConfig(layout), [layout]);
  return <>
    <section className="live-example-controls" aria-label="规范化合约模拟控件"><h2>合成测试 · 未连接实际主机</h2>
      <div className="live-actions" role="group" aria-label="模拟自研 Agent 和 Auto-fix 状态">{(['working', 'idle', 'waiting', 'stopping', 'offline', 'unknown'] as const).map(value => <button key={value} aria-pressed={status === value && !missing && !stale} onClick={() => { source.setStatus(value); setStatus(value); setMissing(false); setStale(false); }}>{liveStatusLabels[value]}</button>)}</div>
      <div className="live-actions"><button aria-pressed={missing} onClick={() => { source.setMissing(!missing); setMissing(!missing); }}>{missing ? '恢复完整快照' : '模拟局部缺失'}</button><button aria-pressed={stale} onClick={() => { source.setStale(!stale); setStale(!stale); }}>{stale ? '恢复新鲜状态' : '模拟状态过期'}</button><button onClick={() => source.replaceEpoch()}>替换 collector epoch</button><button onClick={() => { source.refresh(); setStale(false); }}>刷新合成快照</button></div>
      <label>时钟<select aria-label="合成场景时钟" value={clock} onChange={event => setClock(event.target.value as typeof clock)}><option value="local">本机时间</option><option value="day">模拟白天 12:00</option><option value="night">模拟夜间 23:00</option></select></label>
      {missing && <p role="status">快照不完整，已暂停自动绑定；恢复完整快照后重试。</p>}
    </section>
    <LiveOffice adapterFactory={source.adapterFactory} officeConfig={officeConfig} wallClock={wallClock} wallClockLabel={clock === 'local' ? '本机时间' : '模拟时间'} modeLabel="合成合约示例 · 非真实采集" />
  </>;
}
