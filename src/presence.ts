import type { CharacterId, OfficeAgent, OfficeTopology, PublicOfficeSeatId } from './core.ts';
import { PUBLIC_DESK_IDS, PUBLIC_TABLE_SEAT_IDS } from './core.ts';

/** Public presentation metadata only; never credentials. */
export interface PresenceMapping {
  sourceKinds?: Record<string, string>;
  sourceCharacters?: Record<string, CharacterId>;
  instanceCharacters?: Record<string, CharacterId>;
  sourceLabels?: Record<string, string>;
}

/** Appearance only: never infer source identity or collaboration from provider. */
export function providerCharacter(provider: unknown): CharacterId | undefined {
  if (typeof provider !== 'string') return undefined;
  const key = provider.trim().toLowerCase();
  if (['openai', 'openai-codex', 'azure-openai', 'azure-openai-responses'].includes(key)) return 'chatgpt';
  if (key === 'deepseek') return 'deepseek';
  if (['xai', 'x-ai', 'grok'].includes(key)) return 'grok';
  return undefined;
}

export function presenceStatus(status: OfficeAgent['status']): OfficeAgent['status'] {
  return status === 'stopping' ? 'offline' : status;
}

export function presenceTopology(agents: readonly OfficeAgent[]): OfficeTopology {
  const uniqueFresh = (character: CharacterId) => {
    const candidates = agents.filter(a => a.character === character && a.sourceFreshness === 'fresh' && a.status !== 'offline');
    if (candidates.length === 1) return candidates[0].id;
    const retained = agents.filter(a => a.character === character);
    return candidates.length === 0 && retained.length === 1 ? retained[0].id : undefined;
  };
  const github = uniqueFresh('github');
  return {
    selfAgentId: uniqueFresh('self') ?? '__unbound_owner__', childAgentIds: [],
    ...(github ? { githubAgentId: github } : {}),
    team: { layout: 'independent-desks', memberIds: agents.filter(a => a.character !== 'self' && a.character !== 'github' && (a.sourceFreshness === 'fresh' || a.status === 'offline')).map(a => a.id).sort() },
  };
}

export function presenceCollaboration(data: { member_name: string; task_type?: unknown; task_name?: unknown }, kind?: string): OfficeAgent['collaboration'] {
  const registered = ['DeckZ 协作 PI', 'DeckZ 长线协作 PI', 'Desk 协作 PI'].includes(data.member_name);
  if (kind !== 'pi-collaboration' && !registered && data.task_type !== 'coding_collaboration') return undefined;
  return { group: typeof data.task_name === 'string' && data.task_name.trim() ? data.task_name.trim() : null };
}

/** Browser-local state: surviving instances keep their seats across reconnects. */
export function createPresenceSeatAllocator() {
  const seats = new Map<string, PublicOfficeSeatId>();
  const tables = new Map<string, number>();
  return (topology: OfficeTopology, agents: readonly OfficeAgent[] = []): OfficeTopology => {
    const members = new Set(topology.team.memberIds);
    for (const id of seats.keys()) if (!members.has(id)) seats.delete(id);
    const groups = new Map<string, string[]>();
    for (const agent of agents) {
      const group = agent.collaboration?.group;
      if (!members.has(agent.id) || !group) continue;
      const ids = groups.get(group) ?? [];
      ids.push(agent.id); groups.set(group, ids);
    }
    for (const group of tables.keys()) if (!groups.has(group)) tables.delete(group);
    for (const group of [...groups.keys()].sort()) {
      if (!tables.has(group)) {
        const table = [1, 2].find(n => ![...tables.values()].includes(n));
        if (table) tables.set(group, table);
      }
    }
    const desired = new Map<string, PublicOfficeSeatId>();
    const reserved = new Set<PublicOfficeSeatId>();
    for (const [group, table] of tables) {
      const slots = PUBLIC_TABLE_SEAT_IDS.filter(id => id.startsWith(`public-table-${table}-`));
      slots.forEach(id => reserved.add(id));
      const ids = groups.get(group)!;
      for (const id of ids) {
        const previous = seats.get(id);
        if (previous && slots.includes(previous)) { desired.set(id, previous); slots.splice(slots.indexOf(previous), 1); }
      }
      for (const id of ids.sort()) if (!desired.has(id) && slots.length) desired.set(id, slots.shift()!);
    }
    for (const [id, seat] of seats) {
      if ((reserved.has(seat) && desired.get(id) !== seat) || (desired.has(id) && desired.get(id) !== seat)) seats.delete(id);
    }
    for (const [id, seat] of desired) seats.set(id, seat);
    const used = new Set(seats.values());
    const free = [...PUBLIC_DESK_IDS, ...PUBLIC_TABLE_SEAT_IDS].filter(id => !used.has(id) && !reserved.has(id));
    for (const id of topology.team.memberIds) {
      if (seats.has(id)) continue;
      const seat = free.shift();
      if (seat) seats.set(id, seat);
    }
    return { ...topology, team: { ...topology.team, seatAssignments: Object.fromEntries(seats) } };
  };
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('contract');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 1024) throw new Error('contract');
  return value;
};
const own = <T>(map: Record<string, T> | undefined, key: string): T | undefined =>
  map && Object.hasOwn(map, key) ? map[key] : undefined;

/** The collector's raw full snapshot is converted locally, never by an Office server. */
export function normalizePresence(input: unknown, config: PresenceMapping = {}, allocateSeats = createPresenceSeatAllocator()) {
  const body = record(input);
  if (body.version !== 1 || body.persistence !== 'memory' || body.complete !== true || typeof body.processId !== 'string' || !body.processId ||
      !Array.isArray(body.instances) || body.instances.length > 128 || typeof body.staleAfterMs !== 'number' || !Number.isFinite(body.staleAfterMs) || body.staleAfterMs <= 0) throw new Error('contract');
  const processId = body.processId, staleAfterMs = body.staleAfterMs;
  const agents: OfficeAgent[] = body.instances.map((value: unknown) => {
    const row = record(value), d = record(row.data);
    if (typeof row.sourceId !== 'string' || !row.sourceId || typeof row.instanceId !== 'string' || !row.instanceId || d.instance_id !== row.instanceId ||
        typeof d.member_name !== 'string' || d.member_name.length > 1024 ||
        typeof row.status !== 'string' || !['idle', 'working', 'waiting', 'stopping', 'unknown'].includes(row.status) ||
        typeof row.freshness !== 'string' || !['fresh', 'stale'].includes(row.freshness) || typeof row.ageMs !== 'number' || !Number.isFinite(row.ageMs) || row.ageMs < 0) throw new Error('contract');
    const ttl = row.staleAfterMs ?? staleAfterMs;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) throw new Error('contract');
    const kind = own(config.sourceKinds, row.sourceId);
    const mapped = own(config.instanceCharacters, JSON.stringify([row.sourceId, row.instanceId])) ?? own(config.sourceCharacters, row.sourceId) ??
      (kind === 'auto-fix' ? 'github' : kind === 'self' ? 'self' : undefined) ?? providerCharacter(d.provider);
    const character: CharacterId = mapped && ['self', 'github', 'deepseek', 'chatgpt', 'grok'].includes(mapped) ? mapped : 'unknown';
    return {
      id: JSON.stringify([row.sourceId, row.instanceId]), identity: { sourceId: row.sourceId, instanceId: row.instanceId, collectorEpoch: processId },
      name: d.member_name, character, status: presenceStatus(row.status as OfficeAgent['status']),
      source: row.sourceId, sourceLabel: text(own(config.sourceLabels, row.sourceId)), observedAt: text(row.receivedAt),
      sourceFreshness: row.freshness as OfficeAgent['sourceFreshness'], validForMs: Math.max(1, ttl - row.ageMs), latestUserRequest: null,
      collaboration: presenceCollaboration({ member_name: d.member_name, task_name: d.task_name, task_type: d.task_type }, kind),
      task: { name: text(d.task_name), type: text(d.task_type), startedAt: text(d.task_started_at), detail: text(d.status_detail) },
      provider: text(d.provider), model: text(d.model), repo: text(d.repo),
    };
  });
  if (new Set(agents.map(a => a.id)).size !== agents.length) throw new Error('duplicate');
  return {
    topology: allocateSeats(presenceTopology(agents), agents),
    snapshot: { agents, receivedAt: new Date().toISOString(), identityCoverage: 'complete' as const,
      coverage: `${agents.length} 个授权范围内保留实例；协作按上报组名展示，不代表父子关系。空列表不代表全部退出。未配置类别的实例显示未知外观。` },
  };
}
