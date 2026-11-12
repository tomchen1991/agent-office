/** Physical child capacity; configured identities beyond this remain inspectable overflow. */
export const MAX_VISIBLE_CHILD_AGENTS = 2;
/** Public display contract. Never include credentials or raw collector payloads here. */
export type CharacterId = 'self' | 'deepseek' | 'chatgpt' | 'grok' | 'github' | 'unknown';
export type OfficeStatus = 'idle' | 'working' | 'waiting' | 'stopping' | 'offline' | 'unknown';
export interface AgentIdentity { sourceId: string; instanceId: string; collectorEpoch: string }
export interface UserRequestSummary { summary: string; receivedAt: string; source?: string }
export interface OfficeAgent {
  id: string;
  name: string;
  character: CharacterId;
  status: OfficeStatus;
  latestUserRequest: UserRequestSummary | null;
  /** Presence display metadata; never interpreted as a user request or team identity. */
  task?: { name: string | null; type: string | null; startedAt: string | null; detail: string | null };
  /** Explicit publisher collaboration label; group is reported metadata, not a parent/child identity. */
  collaboration?: { group: string | null };
  repo?: string | null;
  sourceLabel?: string | null;
  provider?: string | null;
  model?: string | null;
  identity?: AgentIdentity;
  observedAt: string | null;
  sourceFreshness?: 'fresh' | 'stale' | 'unknown';
  /** Configured event-driven service, not a heartbeat-based process. */
  presenceMode?: 'on-demand';
  validForMs?: number;
  source: string;
}
export interface OfficeSnapshot { agents: readonly OfficeAgent[]; receivedAt: string; coverage?: string; identityCoverage?: 'complete' | 'partial' | 'unknown' }
export type PublicOfficeSeatId = `public-desk-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}` | `public-table-${1 | 2}-seat-${1 | 2 | 3}`;
export type OfficeSeatAssignments = Readonly<Record<string, PublicOfficeSeatId>>;
export const PUBLIC_DESK_IDS: readonly PublicOfficeSeatId[] = Array.from({length: 10}, (_, index) => `public-desk-${index + 1}` as PublicOfficeSeatId);
export const PUBLIC_TABLE_SEAT_IDS: readonly PublicOfficeSeatId[] = Array.from({length: 6}, (_, index) => `public-table-${Math.floor(index / 3) + 1}-seat-${index % 3 + 1}` as PublicOfficeSeatId);
/** Only public team members can be assigned to public furniture. */
export function validateSeatAssignments(assignments: OfficeSeatAssignments, memberIds: readonly string[]): void {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments) || ![Object.prototype, null].includes(Object.getPrototypeOf(assignments))) throw new Error('Expected plain seat assignments');
  const descriptors = Object.getOwnPropertyDescriptors(assignments);
  const keys = Reflect.ownKeys(assignments);
  if (keys.length > 16 || keys.some(key => typeof key !== 'string')) throw new Error('Invalid seat assignment fields');
  if (Object.values(descriptors).some(value => !('value' in value))) throw new Error('Seat assignment accessors are not supported');
  if (Object.values(descriptors).some(value => !value.enumerable)) throw new Error('Seat assignment fields must be enumerable');
  const occupied = new Set<string>();
  for (const [memberId, physicalId] of Object.entries(assignments)) {
    if (!memberIds.includes(memberId)) throw new Error('Seat assignment must reference a public team member');
    if (typeof physicalId === 'string' && /^public-table-3-seat-[1-3]$/.test(physicalId)) throw new Error('Public table 3 was removed for the dedicated GitHub desk; explicitly reassign this member to table 1/2 or a public desk');
    if (typeof physicalId !== 'string' || !/^public-(?:desk-(?:[1-9]|10)|table-[1-2]-seat-[1-3])$/.test(physicalId)) throw new Error('Invalid public physical seat ID');
    if (occupied.has(physicalId)) throw new Error('Duplicate physical seat assignment');
    occupied.add(physicalId);
  }
}
/** Configuration, not inferred from process roles, provider names or host names. */
export interface OfficeTopology {
  selfAgentId: string;
  childAgentIds: readonly string[];
  /** Dedicated repair/review identity, never inferred from a provider or team leader. */
  githubAgentId?: string;
  team: { layout: 'independent-desks' | 'leader-desks' | 'peer-table'; memberIds: readonly string[]; leaderId?: string; seatAssignments?: OfficeSeatAssignments };
}
export interface AdapterState {
  phase: 'connecting' | 'connected' | 'disconnected';
  snapshot: OfficeSnapshot | null;
  error: string | null;
}
export interface OfficeAdapter {
  subscribe(listener: (state: AdapterState) => void): () => void;
  connect(): void;
  /** Reusable after dispose: supports React Strict Mode setup/cleanup/setup. */
  dispose(): void;
}
/** Age is monotonic elapsed time since renderer received this snapshot, never source wall time. */
export function freshness(agent: OfficeAgent, elapsedSinceReceiptMs: number): 'fresh' | 'stale' | 'unknown' {
  if (agent.sourceFreshness !== 'fresh') return agent.sourceFreshness ?? 'unknown';
  if (!Number.isFinite(elapsedSinceReceiptMs) || elapsedSinceReceiptMs < 0 || !Number.isFinite(agent.validForMs) || agent.validForMs! <= 0) return 'unknown';
  return elapsedSinceReceiptMs >= agent.validForMs! ? 'stale' : 'fresh';
}
export function displayStatus(agent: OfficeAgent, elapsedSinceReceiptMs: number, phase: AdapterState['phase']): OfficeStatus {
  if (phase !== 'connected') return 'unknown';
  if (agent.status === 'offline') return 'offline';
  if (agent.presenceMode === 'on-demand') {
    if (agent.status === 'idle') return 'idle';
    return Number.isFinite(elapsedSinceReceiptMs) && elapsedSinceReceiptMs >= 0 &&
      Number.isFinite(agent.validForMs) && elapsedSinceReceiptMs < agent.validForMs! ? agent.status : 'unknown';
  }
  return freshness(agent, elapsedSinceReceiptMs) === 'fresh' ? agent.status : 'unknown';
}
export function validateTopology(topology: OfficeTopology): void {
  if (!['independent-desks', 'leader-desks', 'peer-table'].includes(topology.team.layout)) throw new Error('Unknown office layout');
  if (topology.team.seatAssignments !== undefined) validateSeatAssignments(topology.team.seatAssignments, topology.team.memberIds);
  const ids = [...(topology.githubAgentId === undefined ? [] : [topology.githubAgentId]), topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds];
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Office IDs must be nonempty and unique');
  if (topology.team.layout === 'leader-desks' && (!topology.team.leaderId || !topology.team.memberIds.includes(topology.team.leaderId))) throw new Error('Leader must be explicitly configured as a team member');
}

export interface OfficeSeatReport {
  /** Includes configured but currently unobserved identities, reserving their seats. */
  assignments: Readonly<Record<string, string>>;
  childOverflowIds: readonly string[];
  teamOverflowIds: readonly string[];
}
/** Children share public furniture; no private desks are permanently reserved. */
export function liveOfficeSeatReport(topology: OfficeTopology): OfficeSeatReport {
  validateTopology(topology);
  const assignments: Record<string, string> = Object.create(null);
  assignments[topology.selfAgentId] = 'self';
  if (topology.githubAgentId !== undefined) assignments[topology.githubAgentId] = 'github-desk';
  const explicit = topology.team.seatAssignments ?? {};
  const used = new Set(Object.values(explicit));
  const preferred = topology.team.layout === 'peer-table'
    ? [...PUBLIC_TABLE_SEAT_IDS, ...PUBLIC_DESK_IDS] : [...PUBLIC_DESK_IDS, ...PUBLIC_TABLE_SEAT_IDS];
  const available = preferred.filter(id => !used.has(id));
  const teamOverflowIds: string[] = [];
  // Explicit positions reserve slots before default positions, regardless of member order.
  for (const id of topology.team.memberIds) {
    const position = Object.hasOwn(explicit, id) ? explicit[id] : available.shift();
    if (position) assignments[id] = position;
    else teamOverflowIds.push(id);
  }
  const childOverflowIds: string[] = [];
  const childSeats = [...PUBLIC_TABLE_SEAT_IDS, ...PUBLIC_DESK_IDS].filter(seat => !Object.values(assignments).includes(seat));
  for (const id of topology.childAgentIds) {
    const seat = childSeats.shift();
    if (seat) assignments[id] = seat;
    else childOverflowIds.push(id);
  }
  return { assignments, childOverflowIds, teamOverflowIds };
}
