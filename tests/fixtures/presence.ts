/** Synthetic collector wire contract, not an Office-normalized DTO. */
export const collectorFrame = (reason = 'initial', sequence = 1) => ({
  version: 1, type: 'snapshot', reason, sequence, persistence: 'memory', complete: true,
  processId: 'synthetic-process', staleAfterMs: 45000,
  startedAt: '2026-01-01T00:00:00Z', observedAt: '2026-01-01T00:00:00Z',
  heartbeatIntervalMs: 15000, expireAfterMs: 600000, historyLimit: 10, total: 1,
  instances: [{ sourceId: 'test', instanceId: 'agent', status: 'working', freshness: 'fresh', ageMs: 0, staleAfterMs: 1000,
    receivedAt: '2026-01-01T00:00:00Z', data: { instance_id: 'agent', member_name: 'Fixture', provider: 'deepseek',
      model: 'fixture-model', task_name: 'Retained task', repo: 'retained-repo', private_field: 'ignored' } }],
});
