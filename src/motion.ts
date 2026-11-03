import type { OfficeStatus } from './core.ts';

export const TRANSITION_MS = 600;
export interface MotionTarget { id: string; seat: string; status: OfficeStatus }
export interface MotionActor extends MotionTarget {
  phase: 'arriving' | 'seated' | 'moving' | 'leaving';
  progress: number;
}
export type MotionState = readonly MotionActor[];
export interface ReconcileOptions { reducedMotion?: boolean; connected?: boolean }
/** Pure latest-target-wins reconciliation. No timers, callbacks or retained request content. */
export function reconcileMotion(previous: MotionState, targets: readonly MotionTarget[], options: ReconcileOptions = {}): MotionState {
  const ids = new Set<string>();
  const seats = new Set<string>();
  for (const target of targets) {
    if (!target.id || !target.seat || ids.has(target.id) || seats.has(target.seat)) throw new Error('Motion target IDs and seats must be unique and nonempty');
    ids.add(target.id); seats.add(target.seat);
  }
  const existing = new Map(previous.map(actor => [actor.id, actor]));
  const disconnected = options.connected === false;
  const result: MotionActor[] = targets.map(target => {
    const old = existing.get(target.id);
    const current = {...target, status: disconnected ? 'unknown' as const : target.status};
    if (options.reducedMotion || disconnected) return {...current, phase: 'seated', progress: 1};
    if (!old || old.phase === 'leaving') return {...current, phase: 'arriving', progress: 0};
    if (old.seat !== target.seat) return {...current, phase: 'moving', progress: 0};
    return {...old, ...current};
  });
  if (!options.reducedMotion && !disconnected) {
    for (const old of previous) {
      if (!ids.has(old.id)) result.push({...old, status: 'unknown', phase: 'leaving', progress: old.phase === 'leaving' ? old.progress : 0});
    }
  }
  return result;
}
/** Caller supplies frame elapsed time; pause freezes transitions but never freezes data freshness. */
export function advanceMotion(state: MotionState, deltaMs: number, options: { paused?: boolean; reducedMotion?: boolean } = {}): MotionState {
  if (options.reducedMotion) return state.filter(actor => actor.phase !== 'leaving').map(actor => ({...actor, phase: 'seated', progress: 1}));
  if (options.paused || !Number.isFinite(deltaMs) || deltaMs <= 0) return state;
  return state.flatMap(actor => {
    if (actor.phase === 'seated') return [actor];
    const progress = Math.min(1, actor.progress + deltaMs / TRANSITION_MS);
    if (actor.phase === 'leaving') return progress >= 1 ? [] : [{...actor, progress}];
    return [{...actor, progress, phase: progress >= 1 ? 'seated' as const : actor.phase}];
  });
}

/** At most one outgoing silhouette per free seat; further departures use the exit lane. */
export function retainedDepartureIds(state: MotionState, configuredSeats: readonly string[], occupiedSeats: readonly string[]): ReadonlySet<string> {
  const free = new Set(configuredSeats.filter(seat => !occupiedSeats.includes(seat)));
  const ids = new Set<string>();
  for (const actor of state) {
    if (actor.phase === 'leaving' && free.delete(actor.seat)) ids.add(actor.id);
  }
  return ids;
}
