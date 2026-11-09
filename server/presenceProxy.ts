import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { get } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Plugin } from 'vite';
import type { CharacterId, OfficeAgent, OfficeTopology, PublicOfficeSeatId } from '../src/core.ts';
import { PUBLIC_DESK_IDS, PUBLIC_TABLE_SEAT_IDS } from '../src/core.ts';
import { attachPresenceStream } from './presenceStreamServer.ts';

/** Appearance only: never infer source identity, seats, or collaboration from provider. */
export function providerCharacter(provider: unknown): CharacterId | undefined {
  if (typeof provider !== 'string') return undefined;
  const key = provider.trim().toLowerCase();
  if (['openai', 'openai-codex', 'azure-openai', 'azure-openai-responses'].includes(key)) return 'chatgpt';
  if (key === 'deepseek') return 'deepseek';
  if (['xai', 'x-ai', 'grok'].includes(key)) return 'grok';
  return undefined;
}

/** Presence stopping is treated as instance offline; other adapters keep their own semantics. */
export function presenceStatus(status: OfficeAgent['status']): OfficeAgent['status'] {
  return status === 'stopping' ? 'offline' : status;
}

/** Dedicated personas prefer live instances; offline bindings survive expiry to finish departure. */
export function presenceTopology(agents: readonly OfficeAgent[]): OfficeTopology {
  const uniqueFresh = (character: CharacterId) => {
    const candidates = agents.filter(a => a.character === character && a.sourceFreshness === 'fresh' && a.status !== 'offline');
    if (candidates.length === 1) return candidates[0].id;
    const retained = agents.filter(a => a.character === character);
    return candidates.length === 0 && retained.length === 1 ? retained[0].id : undefined;
  };
  const owner = uniqueFresh('self') ?? '__unbound_owner__';
  const github = uniqueFresh('github');
  return { selfAgentId: owner, childAgentIds: [], ...(github ? { githubAgentId: github } : {}), team: { layout: 'independent-desks', memberIds: agents.filter(a => a.character !== 'self' && a.character !== 'github' && (a.sourceFreshness === 'fresh' || a.status === 'offline')).map(a => a.id).sort() } };
}

/** Exact labels from pi-monitor's registered publisher contract, not fuzzy name matching.
 * Idle snapshots clear task_type, but retain this label and the registered group name.
 */
export function presenceCollaboration(data: { member_name: string; task_type?: unknown; task_name?: unknown }, kind?: string): OfficeAgent['collaboration'] {
  const registered = ['DeckZ 协作 PI', 'DeckZ 长线协作 PI', 'Desk 协作 PI'].includes(data.member_name);
  if (kind !== 'pi-collaboration' && !registered && data.task_type !== 'coding_collaboration') return undefined;
  return { group: typeof data.task_name === 'string' && data.task_name.trim() ? data.task_name.trim() : null };
}

/** Keep surviving instances in place; explicitly reported groups own separate tables. */
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
      // Preserve members' positions within their table across polling and restarts.
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

/** Fixed same-VPS loopback hop avoids a Cloudflare round trip; never accepts caller URLs. */
function fetchPresence(token: string): Promise<Response> {
  const signal = AbortSignal.timeout(8000);
  if (process.env.OFFICE_PRESENCE_LOOPBACK !== '1') return fetch('https://collect.falsita.cn/api/presence/v1/instances', { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal });
  return new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port: 18788, path: '/api/presence/v1/instances', headers: { Host: 'collect.falsita.cn', Authorization: `Bearer ${token}` }, signal }, response => {
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status: response.statusCode ?? 502 }));
    });
    request.on('error', reject);
  });
}

/** Shared narrow backend; credentials never enter public assets or DTO. */
export function createPresenceHandler(options: { hosts: readonly string[]; origins: readonly string[] } = {
  hosts: ['127.0.0.1:5188', 'localhost:5188'], origins: ['http://127.0.0.1:5188', 'http://localhost:5188'],
}) {
    let busy = false;
    const allocateSeats = createPresenceSeatAllocator();
    return async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const fail = (code: number, error: string) => { res.statusCode = code; res.end(JSON.stringify({ error })); };
      if (req.method !== 'GET' || req.url !== '/' || !options.hosts.includes(req.headers.host ?? '')) return fail(403, '请求不被允许');
      if (req.headers.origin && !options.origins.includes(req.headers.origin)) return fail(403, '来源不被允许');
      if (busy) return fail(429, '正在读取状态，请稍后重试');
      busy = true;
      try {
        const path = process.env.OFFICE_PRESENCE_CONFIG ?? `${homedir()}/.config/agent-office/presence.json`;
        let config;
        try { config = JSON.parse(await readFile(path, 'utf8')); } catch { return fail(503, '尚未配置本地 presence 只读鉴权'); }
        if (typeof config.token !== 'string' || !config.token.trim() || config.enabled !== true) return fail(503, '本地 presence 鉴权尚未启用');
        const response = await fetchPresence(config.token);
        if (!response.ok) { await response.body?.cancel(); return fail(502, `采集服务返回 HTTP ${response.status}`); }
        const reader = response.body!.getReader(); let raw = ''; let bytes = 0;
        const decoder = new TextDecoder();
        while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 1048576) { await reader.cancel(); throw new Error('limit'); } raw += decoder.decode(value, { stream: true }); }
        raw += decoder.decode();
        res.end(JSON.stringify(normalizePresence(JSON.parse(raw), config, allocateSeats)));
      } catch { fail(502, '无法读取可信 presence 状态，请检查连接或契约'); } finally { busy = false; }
    };
}

/** Shared HTTP/WS normalization; only this allowlisted DTO crosses into the browser. */
export function normalizePresence(body: any, config: any, allocateSeats = createPresenceSeatAllocator()) {
        if (body.version !== 1 || body.persistence !== 'memory' || body.complete !== true || typeof body.processId !== 'string' || !Array.isArray(body.instances) || body.instances.length > 128 || !Number.isFinite(body.staleAfterMs)) throw new Error('contract');
        const agents: OfficeAgent[] = body.instances.map((row: any) => {
          const d = row.data;
          if (!d || typeof row.sourceId !== 'string' || typeof row.instanceId !== 'string' || d.instance_id !== row.instanceId || typeof d.member_name !== 'string' || !['idle','working','waiting','stopping','unknown'].includes(row.status) || !['fresh','stale'].includes(row.freshness) || !Number.isFinite(row.ageMs) || row.ageMs < 0) throw new Error('contract');
          const text = (v: unknown): string | null => { if (v == null) return null; if (typeof v !== 'string' || v.length > 1024) throw new Error('contract'); return v; };
          // Persona mappings remain explicit; registered collaboration labels affect grouping only.
          const kind = config.sourceKinds?.[row.sourceId];
          const mapped = config.instanceCharacters?.[JSON.stringify([row.sourceId, row.instanceId])] ?? config.sourceCharacters?.[row.sourceId] ?? (kind === 'auto-fix' ? 'github' : kind === 'self' ? 'self' : undefined) ?? providerCharacter(d.provider);
          const character: CharacterId = ['self','github','deepseek','chatgpt','grok'].includes(mapped) ? mapped : 'unknown';
          return { id: JSON.stringify([row.sourceId, row.instanceId]), identity: { sourceId: row.sourceId, instanceId: row.instanceId, collectorEpoch: body.processId }, name: d.member_name, character, status: presenceStatus(row.status),
            source: row.sourceId, sourceLabel: text(config.sourceLabels?.[row.sourceId]), observedAt: text(row.receivedAt), sourceFreshness: row.freshness,
            validForMs: Math.max(1, (row.staleAfterMs ?? body.staleAfterMs) - row.ageMs), latestUserRequest: null,
            collaboration: presenceCollaboration(d, kind),
            task: { name: text(d.task_name), type: text(d.task_type), startedAt: text(d.task_started_at), detail: text(d.status_detail) }, provider: text(d.provider), model: text(d.model), repo: text(d.repo) };
        });
        if (new Set(agents.map(a => a.id)).size !== agents.length) throw new Error('duplicate');
        const topology = allocateSeats(presenceTopology(agents), agents);
        return { topology, snapshot: { agents, receivedAt: new Date().toISOString(), identityCoverage: 'complete' as const, coverage: `${agents.length} 个授权范围内保留实例；协作按上报组名展示，不代表父子关系。空列表不代表全部退出。未配置类别的实例显示未知外观。` } };
}

export function presenceProxy(): Plugin {
  return { name: 'private-presence-backend', configureServer(server) {
    server.middlewares.use('/api/office/presence', createPresenceHandler());
    if (server.httpServer) {
      const close = attachPresenceStream(server.httpServer, { hosts: ['127.0.0.1:5188', 'localhost:5188'], origins: ['http://127.0.0.1:5188', 'http://localhost:5188'] });
      server.httpServer.once('close', close);
    }
  } };
}
