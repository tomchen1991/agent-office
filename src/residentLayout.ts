/** Frontend-only furniture placement. The existing transport and config API are unchanged. */
import { liveOfficeSeatReport, validateTopology } from './core.ts';
import type { OfficeTopology, OfficeSnapshot, OfficeSeatReport } from './core.ts';
import { parseOfficeConfig } from './config.ts';
import type { OfficeConfig } from './config.ts';
import { bindOffice } from './binding.ts';
import type { BoundOffice } from './binding.ts';

export interface ResidentOfficeTopology extends OfficeTopology { devopsAgentId?: string; hotspotAgentId?: string }
export type ResidentOfficeConfig = OfficeConfig & { office: OfficeConfig['office'] & { devopsSeatId?: string; hotspotSeatId?: string } };

// Guard the objects we copy before reading any values. The core parser still
// validates all nested seats/selectors and text; no accessors are evaluated here.
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected plain config object');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error('Unknown config field');
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) throw new Error('Config accessors are not supported');
  return value as Record<string, unknown>;
}
function memberList(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 128) throw new Error('Invalid config list');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw new Error('Invalid config list fields');
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) throw new Error('Config accessors are not supported');
  return value;
}

// Resolve optional renderer seats through the existing binder as ordinary members,
// then move their display IDs to dedicated furniture. Never add fields to agent DTOs.
function prepareConfig(input: unknown): { base: OfficeConfig; devopsSeatId?: string; hotspotSeatId?: string } {
  const data = record(input, ['version', 'seats', 'office']);
  const sourceOffice = record(data.office, ['selfSeatId', 'childSeatIds', 'githubSeatId', 'devopsSeatId', 'hotspotSeatId', 'team']);
  const { devopsSeatId, hotspotSeatId, ...office } = sourceOffice;
  const team = record(office.team, ['layout', 'memberSeatIds', 'leaderSeatId', 'seatAssignments']);
  const members = memberList(team.memberSeatIds);
  const ids: string[] = [];
  for (const key of ['devopsSeatId', 'hotspotSeatId'] as const) {
    if (!Object.hasOwn(sourceOffice, key)) continue;
    const value = sourceOffice[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid resident display seat');
    ids.push(value);
  }
  const base = parseOfficeConfig({ ...data, office: { ...office, team: { ...team, memberSeatIds: [...members, ...ids] } } });
  if (ids.some(id => id === base.office.team.leaderSeatId || Object.hasOwn(base.office.team.seatAssignments ?? {}, id))) throw new Error('Resident seats cannot also be public assignments');
  return { base, ...(devopsSeatId === undefined ? {} : { devopsSeatId: devopsSeatId as string }), ...(hotspotSeatId === undefined ? {} : { hotspotSeatId: hotspotSeatId as string }) };
}

export function parseResidentOfficeConfig(input: unknown): ResidentOfficeConfig {
  const { base, devopsSeatId, hotspotSeatId } = prepareConfig(input);
  const extras = [devopsSeatId, hotspotSeatId];
  return { ...base, office: { ...base.office, ...(devopsSeatId === undefined ? {} : { devopsSeatId }), ...(hotspotSeatId === undefined ? {} : { hotspotSeatId }), team: { ...base.office.team, memberSeatIds: base.office.team.memberSeatIds.filter(id => !extras.includes(id)) } } };
}

export function bindResidentOffice(config: ResidentOfficeConfig, snapshot: OfficeSnapshot): Omit<BoundOffice, 'topology'> & { topology: ResidentOfficeTopology } {
  const { base, devopsSeatId, hotspotSeatId } = prepareConfig(config);
  const bound = bindOffice(base, snapshot);
  const displayId = (seatId: string | undefined) => seatId === undefined ? undefined : bound.topology.team.memberIds[base.office.team.memberSeatIds.indexOf(seatId)];
  const devopsAgentId = displayId(devopsSeatId), hotspotAgentId = displayId(hotspotSeatId);
  const topology: ResidentOfficeTopology = { ...bound.topology,
    ...(devopsAgentId === undefined ? {} : { devopsAgentId }), ...(hotspotAgentId === undefined ? {} : { hotspotAgentId }),
    team: { ...bound.topology.team, memberIds: bound.topology.team.memberIds.filter(id => id !== devopsAgentId && id !== hotspotAgentId) },
  };
  validateResidentTopology(topology);
  return { ...bound, topology };
}

export function validateResidentTopology(topology: ResidentOfficeTopology): void {
  validateTopology(topology);
  const ids = [topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds,
    ...[topology.githubAgentId, topology.devopsAgentId, topology.hotspotAgentId].filter(id => id !== undefined)];
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Office IDs must be nonempty and unique');
}

export function residentSeatReport(topology: ResidentOfficeTopology): OfficeSeatReport {
  validateResidentTopology(topology);
  const base = liveOfficeSeatReport(topology);
  const report = { ...base, assignments: Object.assign(Object.create(null) as Record<string, string>, base.assignments) };
  if (topology.devopsAgentId !== undefined) report.assignments[topology.devopsAgentId] = 'devops-desk';
  if (topology.hotspotAgentId !== undefined) report.assignments[topology.hotspotAgentId] = 'hotspot-desk';
  return report;
}
