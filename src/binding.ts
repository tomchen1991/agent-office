import type { OfficeSnapshot, OfficeTopology } from './core.ts';
import { parseOfficeConfig } from './config.ts';
import type { OfficeConfig } from './config.ts';

export interface BindingWarning { seatId: string; code: 'unmatched' | 'ambiguous' | 'incomplete'; message: string }
export interface BoundOffice {
  snapshot: OfficeSnapshot;
  topology: OfficeTopology;
  bindings: Readonly<Record<string, string | null>>;
  warnings: readonly BindingWarning[];
}
/** Stateless binding: never carry a previous epoch's persona, requests, or active status forward. */
export function bindOffice(configInput: OfficeConfig, snapshot: OfficeSnapshot): BoundOffice {
  const config = parseOfficeConfig(configInput);
  const allIds = new Set(snapshot.agents.map(agent => agent.id));
  if (allIds.size !== snapshot.agents.length) throw new Error('Snapshot agent IDs must be unique');
  const bindings: Record<string, string | null> = Object.create(null);
  const displayIds: Record<string, string> = Object.create(null);
  const warnings: BindingWarning[] = [];
  const boundAgents: OfficeSnapshot['agents'][number][] = [];
  const used = new Set<string>();
  for (const seat of config.seats) {
    const matches = snapshot.agents.filter(agent => {
      const identity = agent.identity;
      return identity && identity.sourceId === seat.selector.sourceId && identity.instanceId === seat.selector.instanceId &&
        (seat.selector.epoch.policy === 'follow-unique' || identity.collectorEpoch === seat.selector.epoch.value);
    });
    const incomplete = seat.selector.epoch.policy === 'follow-unique' && snapshot.identityCoverage !== 'complete';
    if (matches.length === 1 && !incomplete) {
      const agent = matches[0];
      if (used.has(agent.id)) throw new Error('An instance cannot occupy multiple seats');
      used.add(agent.id);
      bindings[seat.id] = agent.id;
      displayIds[seat.id] = agent.id;
      boundAgents.push({...agent, name: seat.name, character: seat.character});
    } else {
      bindings[seat.id] = null;
      // Vacant display keys cannot collide with any actual adapter identity.
      let key = JSON.stringify(['unbound-seat', seat.id]);
      while (allIds.has(key)) key += '_';
      allIds.add(key); displayIds[seat.id] = key;
      const code = incomplete ? 'incomplete' : matches.length === 0 ? 'unmatched' : 'ambiguous';
      warnings.push({seatId: seat.id, code, message: code === 'incomplete' ? '身份覆盖不完整或未知，不能确定唯一 epoch；请使用确切 epoch 或提供完整快照。' : code === 'unmatched' ? '没有匹配实例；保持空位。' : '多个实例符合显式选择器；保持空位，请选择确切 epoch。'});
    }
  }
  return {
    snapshot: {...snapshot, agents: boundAgents, identityCoverage: boundAgents.length === snapshot.agents.length ? snapshot.identityCoverage : 'partial'}, bindings, warnings,
    topology: {
      selfAgentId: displayIds[config.office.selfSeatId],
      childAgentIds: config.office.childSeatIds.map(id => displayIds[id]),
      team: {
        layout: config.office.team.layout,
        memberIds: config.office.team.memberSeatIds.map(id => displayIds[id]),
        ...(config.office.team.seatAssignments ? {seatAssignments: Object.fromEntries(Object.entries(config.office.team.seatAssignments).map(([id, physicalId]) => [displayIds[id], physicalId]))} : {}),
        ...(config.office.team.leaderSeatId ? {leaderId: displayIds[config.office.team.leaderSeatId]} : {}),
      },
    },
  };
}
