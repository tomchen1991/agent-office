/** Public display contract. Never include credentials or raw collector payloads here. */
export type CharacterId = 'self' | 'deepseek' | 'chatgpt' | 'grok' | 'unknown';
export type OfficeStatus = 'idle' | 'working' | 'waiting' | 'stopping' | 'offline' | 'unknown';
export interface AgentIdentity { sourceId: string; instanceId: string; collectorEpoch: string }
export interface UserRequestSummary { summary: string; receivedAt: string; source?: string }
export interface OfficeAgent {
  id: string;
  name: string;
  character: CharacterId;
  status: OfficeStatus;
  latestUserRequest: UserRequestSummary | null;
  identity?: AgentIdentity;
  observedAt: string | null;
  sourceFreshness?: 'fresh' | 'stale' | 'unknown';
  validForMs?: number;
  source: string;
}
export interface OfficeSnapshot { agents: readonly OfficeAgent[]; receivedAt: string; coverage?: string; identityCoverage?: 'complete' | 'partial' | 'unknown' }
/** Configuration, not inferred from process roles, provider names or host names. */
export interface OfficeTopology {
  selfAgentId: string;
  childAgentIds: readonly string[];
  team: { layout: 'leader-desks' | 'peer-table'; memberIds: readonly string[]; leaderId?: string };
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
  return freshness(agent, elapsedSinceReceiptMs) === 'fresh' ? agent.status : 'unknown';
}
export function validateTopology(topology: OfficeTopology): void {
  const ids = [topology.selfAgentId, ...topology.childAgentIds, ...topology.team.memberIds];
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Office IDs must be nonempty and unique');
  if (topology.team.layout === 'leader-desks' && (!topology.team.leaderId || !topology.team.memberIds.includes(topology.team.leaderId))) throw new Error('Leader must be explicitly configured as a team member');
}
