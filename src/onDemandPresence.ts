import type { OfficeAgent } from './core.ts';

export interface OnDemandSource {
  name: string;
  /** Long tasks report every 15s. Missing updates must not imply completion. */
  taskTimeoutMs: number;
}

/** Per-subscription memory survives reconnects and collector instance expiry. */
export function createOnDemandPresenceTracker(now: () => number = () => performance.now()) {
  const retained = new Map<string, { agent: OfficeAgent; deadline: number; observation?: string }>();
  return (agents: OfficeAgent[], sources: Record<string, OnDemandSource> = {}): OfficeAgent[] => {
    const at = now();
    for (const source of retained.keys()) if (!Object.hasOwn(sources, source)) retained.delete(source);
    const result = agents.filter(agent => !Object.hasOwn(sources, agent.source));
    for (const [source, config] of Object.entries(sources)) {
      const rows = agents.filter(agent => agent.source === source);
      const active = rows.filter(agent => agent.sourceFreshness === 'fresh' && agent.status !== 'offline');
      const selected = active.length === 1 ? active[0] : rows.length === 1 ? rows[0] : undefined;
      let previous = retained.get(source);
      const observation = selected ? JSON.stringify([selected.identity?.instanceId, selected.observedAt]) : undefined;
      // A freshness rewrite of the same event is not a new task event.
      // Preserve completion, or let the existing working deadline expire normally.
      const expiredObservation = selected?.status === 'unknown' && selected.sourceFreshness === 'stale' &&
        previous !== undefined && previous.observation === observation;
      if (selected && !expiredObservation) {
        // stopping is the publisher's completion event, not a process departure.
        const status = selected.status === 'offline' ? 'idle' : selected.status;
        const remaining = Math.max(0, selected.validForMs ?? 0);
        previous = { agent: { ...selected, status }, deadline: at + remaining, observation };
      } else if (!selected && rows.length > 0) {
        // Ambiguous concurrent invocations cannot safely claim completion.
        previous = { agent: { ...(previous?.agent ?? rows[0]), status: 'unknown' }, deadline: at };
      }
      if (!previous) {
        previous = { agent: {
          id: '', name: config.name, character: 'unknown', status: 'idle', source,
          observedAt: null, sourceFreshness: 'unknown', latestUserRequest: null,
        }, deadline: at };
      }
      const agent: OfficeAgent = {
        ...previous.agent,
        id: JSON.stringify(['on-demand', source]),
        // Stable logical identity; a new Worker invocation must not make it exit.
        identity: { sourceId: source, instanceId: 'on-demand', collectorEpoch: 'configured-service' },
        presenceMode: 'on-demand',
        validForMs: Math.max(0, previous.deadline - at),
      };
      if (agent.status !== 'idle' && agent.validForMs === 0) agent.status = 'unknown';
      retained.set(source, { agent, deadline: previous.deadline, observation: previous.observation });
      result.push(agent);
    }
    return result;
  };
}
