import { validateSeatAssignments } from './core.ts';
import type { OfficeSeatAssignments, CharacterId } from './core.ts';

export type EpochPolicy = { policy: 'exact'; value: string } | { policy: 'follow-unique' };
export interface SeatConfig {
  id: string;
  name: string;
  character: CharacterId;
  selector: { sourceId: string; instanceId: string; epoch: EpochPolicy };
}
export interface OfficeConfig {
  version: 1;
  seats: readonly SeatConfig[];
  office: {
    selfSeatId: string;
    childSeatIds: readonly string[];
    team: { layout: 'independent-desks' | 'leader-desks' | 'peer-table'; memberSeatIds: readonly string[]; leaderSeatId?: string; seatAssignments?: OfficeSeatAssignments };
  };
}
const MAX_JSON_BYTES = 128 * 1024;
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected plain config object');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error('Unknown config field');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) throw new Error('Config accessors are not supported');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error('Invalid config text');
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 128) throw new Error('Invalid config list');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw new Error('Invalid config list fields');
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor))) throw new Error('Config accessors are not supported');
  return value;
}
function seat(value: unknown): SeatConfig {
  const data = object(value, ['id', 'name', 'character', 'selector']);
  const selector = object(data.selector, ['sourceId', 'instanceId', 'epoch']);
  const epoch = object(selector.epoch, ['policy', 'value']);
  let policy: EpochPolicy;
  if (epoch.policy === 'exact') policy = { policy: 'exact', value: string(epoch.value) };
  else if (epoch.policy === 'follow-unique' && !Object.hasOwn(epoch, 'value')) policy = { policy: 'follow-unique' };
  else throw new Error('Invalid epoch selection policy');
  if (typeof data.character !== 'string' || !['self', 'deepseek', 'chatgpt', 'grok', 'unknown'].includes(data.character)) throw new Error('Invalid character');
  return { id: string(data.id), name: string(data.name, 100), character: data.character as CharacterId,
    selector: {sourceId: string(selector.sourceId), instanceId: string(selector.instanceId), epoch: policy} };
}
/** Validates and copies only known presentation/binding fields. No credentials or endpoint configuration. */
export function parseOfficeConfig(input: unknown): OfficeConfig {
  const data = object(input, ['version', 'seats', 'office']);
  if (data.version !== 1) throw new Error('Unsupported office config version');
  const seats = array(data.seats).map(seat);
  if (!seats.length) throw new Error('At least one logical seat is required');
  const ids = new Set(seats.map(item => item.id));
  if (ids.size !== seats.length) throw new Error('Duplicate logical seat IDs');
  for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
    const left = seats[i].selector, right = seats[j].selector;
    if (left.sourceId === right.sourceId && left.instanceId === right.instanceId &&
      (left.epoch.policy === 'follow-unique' || right.epoch.policy === 'follow-unique' || left.epoch.value === right.epoch.value)) throw new Error('Conflicting instance selectors');
  }
  const office = object(data.office, ['selfSeatId', 'childSeatIds', 'team']);
  const team = object(office.team, ['layout', 'memberSeatIds', 'leaderSeatId', 'seatAssignments']);
  if (team.layout !== 'independent-desks' && team.layout !== 'leader-desks' && team.layout !== 'peer-table') throw new Error('Invalid team layout');
  const selfSeatId = string(office.selfSeatId);
  const childSeatIds = array(office.childSeatIds).map(value => string(value));
  const memberSeatIds = array(team.memberSeatIds).map(value => string(value));
  const assigned = [selfSeatId, ...childSeatIds, ...memberSeatIds];
  if (new Set(assigned).size !== assigned.length) throw new Error('Duplicate office assignments');
  if (assigned.some(id => !ids.has(id)) || assigned.length !== seats.length) throw new Error('Missing or unassigned logical seat');
  let normalizedTeam: OfficeConfig['office']['team'];
  if (team.layout === 'leader-desks') {
    const leaderSeatId = string(team.leaderSeatId);
    if (!memberSeatIds.includes(leaderSeatId)) throw new Error('Leader must be an explicitly assigned team member');
    normalizedTeam = { layout: 'leader-desks', memberSeatIds, leaderSeatId };
  } else {
    if (Object.hasOwn(team, 'leaderSeatId')) throw new Error('Equal office layouts must not configure a leader');
    normalizedTeam = { layout: team.layout, memberSeatIds };
  }
  if (Object.hasOwn(team, 'seatAssignments')) {
    validateSeatAssignments(team.seatAssignments as OfficeSeatAssignments, memberSeatIds);
    normalizedTeam.seatAssignments = { ...(team.seatAssignments as OfficeSeatAssignments) };
  }
  return { version: 1, seats, office: { selfSeatId, childSeatIds, team: normalizedTeam } };
}
export function importOfficeConfig(json: string): OfficeConfig {
  if (typeof json !== 'string' || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES) throw new Error('Config JSON exceeds size limit');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('Invalid config JSON'); }
  return parseOfficeConfig(value);
}
export function exportOfficeConfig(config: OfficeConfig): string {
  const json = JSON.stringify(parseOfficeConfig(config), null, 2) + '\n';
  if (new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES) throw new Error('Config JSON exceeds size limit');
  return json;
}
