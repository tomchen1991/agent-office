import type { AdapterState, OfficeAdapter } from './core.ts';
import { OFFICE_BRIDGE_CHANNELS, OFFICE_BRIDGE_ERROR, OFFICE_BRIDGE_LIMITS, parseBridgeEvent, sanitizeBridgeState, unavailableState } from './bridgeProtocol.ts';
import type { OfficeBridgeApi, OfficeBridgeCommand } from './bridgeProtocol.ts';

export interface OfficeBridgeClock { now?: () => number }
/** A replay is not a new source observation: consume elapsed monotonic freshness. */
function ageState(value: AdapterState, elapsed: number): AdapterState {
  const state = sanitizeBridgeState(value);
  if (!state.snapshot) return state;
  state.snapshot.agents = state.snapshot.agents.map(agent => {
    if (agent.sourceFreshness !== 'fresh') return agent;
    const remaining = Number.isFinite(elapsed) && elapsed >= 0 && agent.validForMs !== undefined ? Math.floor(agent.validForMs - elapsed) : NaN;
    if (remaining > 0) return {...agent, validForMs: remaining};
    const {validForMs: _expired, ...rest} = agent;
    return {...rest, status: agent.status === 'offline' ? 'offline' : 'unknown', observedAt: null, sourceFreshness: Number.isFinite(remaining) ? 'stale' : 'unknown'};
  });
  return state;
}

/** Structural subset of Electron. The host supplies ipcRenderer only inside preload. */
export interface OfficeIpcRenderer {
  invoke(channel: string, command: OfficeBridgeCommand): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}
export interface OfficeContextBridge { exposeInMainWorld(key: string, api: OfficeBridgeApi): void }

/** One API per preload document. Electron objects and IPC events never reach page callbacks. */
export function createOfficePreloadApi(ipc: OfficeIpcRenderer, clock: OfficeBridgeClock = {}): OfficeBridgeApi {
  const now = clock.now ?? (() => performance.now());
  const listeners = new Set<(state: AdapterState) => void>();
  let sequence = 0;
  let subscriptionId: number | null = null;
  let latest: AdapterState | null = null;
  let latestAt = now();
  let appliedId: number | null = null;
  let pumping = false;
  const notify = (state: AdapterState) => {
    latest = state; latestAt = now();
    for (const listener of [...listeners]) {
      // Copy per callback: one renderer consumer cannot mutate another consumer's snapshot.
      try { listener(ageState(state, now() - latestAt)); } catch { /* A consumer cannot break subscription cleanup. */ }
    }
  };
  const onState = (_event: unknown, payload: unknown) => {
    const message = parseBridgeEvent(payload);
    if (message && message.subscriptionId === subscriptionId) notify(message.state);
  };
  const reconcile = async () => {
    if (pumping) return;
    pumping = true;
    try {
      // Coalesce churn and keep at most one unresolved IPC request. Cleanup is never dropped.
      while (subscriptionId !== appliedId) {
        const desired = subscriptionId;
        const id = desired ?? appliedId!;
        const action: OfficeBridgeCommand['action'] = desired === null ? 'unsubscribe' : 'subscribe';
        try {
          const reply = await ipc.invoke(OFFICE_BRIDGE_CHANNELS.control, {action, subscriptionId: id});
          if (!reply || typeof reply !== 'object' || !Object.hasOwn(reply, 'ok') || (reply as {ok: unknown}).ok !== true) throw new Error(OFFICE_BRIDGE_ERROR);
        } catch { if (subscriptionId === id) notify(unavailableState()); }
        // Even failed replies may have an uncertain outcome: retain the ID for cleanup.
        appliedId = desired;
      }
    } finally { pumping = false; }
  };
  return Object.freeze({
    subscribe(listener: (state: AdapterState) => void) {
      if (typeof listener !== 'function' || listeners.size >= OFFICE_BRIDGE_LIMITS.listeners || sequence >= 2_147_483_647) throw new Error(OFFICE_BRIDGE_ERROR);
      // A wrapper gives repeated subscriptions of the same callback independent cancellation.
      const callback = (state: AdapterState) => listener(state);
      listeners.add(callback);
      if (subscriptionId === null) {
        const id = ++sequence;
        subscriptionId = id; latest = null;
        ipc.on(OFFICE_BRIDGE_CHANNELS.state, onState);
        void reconcile();
      } else if (latest) {
        try { callback(ageState(latest, now() - latestAt)); } catch { /* Consumer exception is isolated. */ }
      }
      let canceled = false;
      return () => {
        if (canceled) return;
        canceled = true; listeners.delete(callback);
        if (listeners.size === 0 && subscriptionId !== null) {
          subscriptionId = null; latest = null;
          ipc.removeListener(OFFICE_BRIDGE_CHANNELS.state, onState);
          void reconcile();
        }
      };
    },
  });
}
export function exposeOfficePreload(contextBridge: OfficeContextBridge, ipcRenderer: OfficeIpcRenderer): OfficeBridgeApi {
  const api = createOfficePreloadApi(ipcRenderer);
  contextBridge.exposeInMainWorld('agentOffice', api);
  return api;
}

/** Renderer-only adapter. Own one instance per mounted office; no Electron or Node import. */
export function createBridgeAdapter(api: OfficeBridgeApi, clock: OfficeBridgeClock = {}): OfficeAdapter {
  const now = clock.now ?? (() => performance.now());
  const listeners = new Set<(state: AdapterState) => void>();
  let state: AdapterState = {phase: 'disconnected', snapshot: null, error: null};
  let stateAt = now();
  let stop: (() => void) | null = null;
  let active = false;
  let generation = 0;
  const emit = (next: AdapterState) => {
    state = sanitizeBridgeState(next); stateAt = now();
    for (const listener of [...listeners]) { try { listener(ageState(state, now() - stateAt)); } catch { /* Isolate UI consumers. */ } }
  };
  return {
    subscribe(listener) {
      listeners.add(listener); listener(ageState(state, now() - stateAt));
      return () => { listeners.delete(listener); };
    },
    connect() {
      if (active) return;
      active = true;
      const current = ++generation;
      emit({phase: 'connecting', snapshot: null, error: null});
      try {
        const cancel = api.subscribe(next => { if (active && generation === current) emit(next); });
        if (active && generation === current) stop = cancel;
        else cancel();
      } catch { if (generation === current) { active = false; emit(unavailableState()); } }
    },
    dispose() {
      active = false; generation++;
      const cancel = stop; stop = null;
      try { cancel?.(); } catch { /* Fail closed even when a host API is unavailable. */ }
      emit({phase: 'disconnected', snapshot: null, error: null});
    },
  };
}
