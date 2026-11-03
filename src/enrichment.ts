import type { OfficeSnapshot } from './core.ts';

/** Explicit trusted host input, NOT fields claimed to exist in collect-service. */
export interface UserRequestEnrichment {
  agentId: string;
  summary: string;
  receivedAt: string;
  source: string;
}
export interface OfficeEnrichment { userRequests: readonly UserRequestEnrichment[] }
export interface EnrichmentResult { snapshot: OfficeSnapshot; unmatchedAgentIds: readonly string[]; ignoredOlderAgentIds: readonly string[] }
/** Exact current-instance ID only; no matching by persona, seat, or previous epoch. */
export function enrichOfficeSnapshot(snapshot: OfficeSnapshot, enrichment: OfficeEnrichment): EnrichmentResult {
  const current = new Set(snapshot.agents.map(agent => agent.id));
  if (current.size !== snapshot.agents.length) throw new Error('Snapshot agent IDs must be unique');
  const requests = new Map<string, UserRequestEnrichment>();
  const unmatchedAgentIds: string[] = [];
  const ignoredOlderAgentIds: string[] = [];
  for (const request of enrichment.userRequests) {
    if (requests.has(request.agentId)) throw new Error('Duplicate request enrichment');
    if (!request.agentId || !request.summary.trim() || request.summary.length > 10_000 || !request.source.trim() || request.source.length > 128 || !Number.isFinite(Date.parse(request.receivedAt))) throw new Error('Invalid user-request enrichment');
    requests.set(request.agentId, request);
    if (!current.has(request.agentId)) unmatchedAgentIds.push(request.agentId);
  }
  return {
    snapshot: {...snapshot, agents: snapshot.agents.map(agent => {
      const request = requests.get(agent.id);
      if (request && agent.latestUserRequest && Date.parse(request.receivedAt) < Date.parse(agent.latestUserRequest.receivedAt)) { ignoredOlderAgentIds.push(agent.id); return agent; }
      return request ? {...agent, latestUserRequest: {summary: request.summary, receivedAt: request.receivedAt, source: request.source}} : agent;
    })},
    unmatchedAgentIds, ignoredOlderAgentIds,
  };
}
