/** Renderer-safe, bounded display-only IPC contract. No host configuration or credentials. */
import type { AdapterState, OfficeAgent, OfficeSnapshot } from './core.ts';

export const OFFICE_BRIDGE_CHANNELS = Object.freeze({ control: 'agent-office:control:v1', state: 'agent-office:state:v1' });
export const OFFICE_BRIDGE_ERROR = 'Office data is unavailable.';
export const OFFICE_BRIDGE_LIMITS = Object.freeze({ agents: 1312, listeners: 64, id: 2048, text: 512, summary: 10_000, coverage: 2048, validForMs: 86_400_000 });
export interface OfficeBridgeApi { subscribe(listener: (state: AdapterState) => void): () => void }
export interface OfficeBridgeCommand { action: 'subscribe' | 'unsubscribe'; subscriptionId: number }
export interface OfficeBridgeEvent { subscriptionId: number; state: AdapterState }
export type OfficeBridgeReply = { ok: true } | { ok: false; error: typeof OFFICE_BRIDGE_ERROR };
export const unavailableState = (): AdapterState => ({ phase: 'disconnected', snapshot: null, error: OFFICE_BRIDGE_ERROR });

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(OFFICE_BRIDGE_ERROR);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 32 || Object.values(descriptors).some(descriptor => !('value' in descriptor))) throw new Error(OFFICE_BRIDGE_ERROR);
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number = OFFICE_BRIDGE_LIMITS.text, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum) throw new Error(OFFICE_BRIDGE_ERROR);
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(OFFICE_BRIDGE_ERROR);
  return value as T;
}
function timestamp(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error(OFFICE_BRIDGE_ERROR);
  return result;
}
export function validSubscriptionId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}
export function parseBridgeCommand(value: unknown): OfficeBridgeCommand | null {
  try {
    const input = record(value);
    if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'action') || !Object.hasOwn(input, 'subscriptionId') || !validSubscriptionId(input.subscriptionId)) return null;
    return { action: choice(input.action, ['subscribe', 'unsubscribe']), subscriptionId: input.subscriptionId };
  } catch { return null; }
}
function agentDTO(value: unknown): OfficeAgent {
  const input = record(value);
  const result: OfficeAgent = {
    id: text(input.id, OFFICE_BRIDGE_LIMITS.id), name: text(input.name),
    character: choice(input.character, ['self', 'deepseek', 'chatgpt', 'grok', 'github', 'unknown']),
    status: choice(input.status, ['idle', 'working', 'waiting', 'stopping', 'offline', 'unknown']),
    source: text(input.source), observedAt: input.observedAt === null ? null : timestamp(input.observedAt), latestUserRequest: null,
  };
  if (input.identity !== undefined) {
    const identity = record(input.identity);
    result.identity = { sourceId: text(identity.sourceId), instanceId: text(identity.instanceId), collectorEpoch: text(identity.collectorEpoch) };
  }
  if (input.latestUserRequest !== null) {
    const request = record(input.latestUserRequest);
    result.latestUserRequest = { summary: text(request.summary, OFFICE_BRIDGE_LIMITS.summary, true), receivedAt: timestamp(request.receivedAt) };
    if (request.source !== undefined) result.latestUserRequest.source = text(request.source);
  }
  if (input.sourceFreshness !== undefined) result.sourceFreshness = choice(input.sourceFreshness, ['fresh', 'stale', 'unknown'] as const);
  if (input.validForMs !== undefined) {
    if (typeof input.validForMs !== 'number' || !Number.isSafeInteger(input.validForMs) || input.validForMs <= 0 || input.validForMs > OFFICE_BRIDGE_LIMITS.validForMs) throw new Error(OFFICE_BRIDGE_ERROR);
    result.validForMs = input.validForMs;
  }
  return result;
}
function snapshotDTO(value: unknown): OfficeSnapshot {
  const input = record(value);
  if (!Array.isArray(input.agents) || Object.getPrototypeOf(input.agents) !== Array.prototype || input.agents.length > OFFICE_BRIDGE_LIMITS.agents) throw new Error(OFFICE_BRIDGE_ERROR);
  const entries = input.agents;
  const keys = Reflect.ownKeys(entries);
  if (keys.length !== entries.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= entries.length)) ||
      Object.values(Object.getOwnPropertyDescriptors(entries)).some(descriptor => !('value' in descriptor))) throw new Error(OFFICE_BRIDGE_ERROR);
  const agents = Array.from(entries, agentDTO);
  if (new Set(agents.map(agent => agent.id)).size !== agents.length) throw new Error(OFFICE_BRIDGE_ERROR);
  const result: OfficeSnapshot = { agents, receivedAt: timestamp(input.receivedAt) };
  if (input.coverage !== undefined) result.coverage = text(input.coverage, OFFICE_BRIDGE_LIMITS.coverage, true);
  if (input.identityCoverage !== undefined) result.identityCoverage = choice(input.identityCoverage, ['complete', 'partial', 'unknown'] as const);
  return result;
}
/** Copy only known fields. Invalid display data fails closed; raw errors never leave main. */
export function sanitizeBridgeState(value: unknown): AdapterState {
  try {
    const input = record(value);
    const phase = choice(input.phase, ['connecting', 'connected', 'disconnected']);
    if (input.error !== null && typeof input.error !== 'string') throw new Error(OFFICE_BRIDGE_ERROR);
    return { phase, snapshot: input.snapshot === null ? null : snapshotDTO(input.snapshot), error: input.error === null ? null : OFFICE_BRIDGE_ERROR };
  } catch { return unavailableState(); }
}
export function parseBridgeEvent(value: unknown): OfficeBridgeEvent | null {
  try {
    const input = record(value);
    if (!validSubscriptionId(input.subscriptionId)) return null;
    return { subscriptionId: input.subscriptionId, state: sanitizeBridgeState(input.state) };
  } catch { return null; }
}
