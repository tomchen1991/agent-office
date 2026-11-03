import type { AdapterState, OfficeAdapter, OfficeSnapshot, OfficeTopology } from './core.ts';
export const demoTopology: OfficeTopology = {
  selfAgentId: 'self', childAgentIds: ['child-1', 'child-2', 'child-3', 'child-4'],
  team: { layout: 'leader-desks', memberIds: ['deepseek', 'chatgpt', 'grok'], leaderId: 'deepseek' },
};
/** Deterministic for an injected clock; no simulated random model activity. */
export function mockSnapshot(now: number): OfficeSnapshot {
  const timestamp = new Date(now).toISOString();
  return {
    receivedAt: timestamp,
    agents: [
      { id: 'self', name: '自研 Agent', character: 'self', status: 'idle', latestUserRequest: { summary: '【模拟请求】请检查办公室布局。', receivedAt: timestamp }, observedAt: timestamp, sourceFreshness: 'fresh' as const, validForMs: 30_000, source: 'mock' },
      ...(['deepseek', 'chatgpt', 'grok'] as const).map((character, index) => ({ id: character, name: ['DeepSeek', 'ChatGPT', 'Grok'][index], character, status: 'unknown' as const, latestUserRequest: null, observedAt: timestamp, sourceFreshness: 'fresh' as const, validForMs: 30_000, source: 'mock' })),
      ...demoTopology.childAgentIds.map((id, index) => ({ id, name: `子 Agent ${index + 1}`, character: 'self' as const, status: 'idle' as const, latestUserRequest: null, observedAt: timestamp, sourceFreshness: 'fresh' as const, validForMs: 30_000, source: 'mock' })),
    ],
  };
}
export function createMockAdapter(now: () => number = Date.now): OfficeAdapter {
  const listeners = new Set<(state: AdapterState) => void>();
  let state: AdapterState = { phase: 'disconnected', snapshot: null, error: null };
  let active = false;
  const emit = () => { for (const listener of listeners) listener(state); };
  return {
    subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    connect() { if (active) return; active = true; state = { phase: 'connected', snapshot: mockSnapshot(now()), error: null }; emit(); },
    dispose() { active = false; state = { ...state, phase: 'disconnected' }; emit(); },
  };
}
