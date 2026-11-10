import type { OfficeStatus } from './core.ts';

export interface OverflowTarget { id: string; identityKey: string; status: OfficeStatus }
export interface OverflowActor extends OverflowTarget { distance: number; elapsedMs: number; lane: number }
/** Bottom public aisle, clear of desk fronts. Stable identity seeds avoid reshuffling survivors. */
export function overflowSeed(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function reconcileOverflow(previous: readonly OverflowActor[], targets: readonly OverflowTarget[]): OverflowActor[] {
  return targets.filter(target => target.status !== 'offline').map(target => {
    const old = previous.find(actor => actor.id === target.id && actor.identityKey === target.identityKey);
    const seed = overflowSeed(target.identityKey);
    return { ...target, distance: old?.distance ?? seed % 2400, lane: old?.lane ?? seed % 3,
      elapsedMs: old?.status === target.status ? old.elapsedMs : 0 };
  });
}
export function advanceOverflow(actors: readonly OverflowActor[], deltaMs: number): OverflowActor[] {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return [...actors];
  return actors.map(actor => actor.status === 'idle' || actor.status === 'working'
    ? { ...actor, distance: actor.status === 'idle' ? (actor.distance + deltaMs * .045) % 2400 : actor.distance,
      elapsedMs: (actor.elapsedMs + deltaMs) % 120000 } : actor);
}
export function overflowPlacement(actor: OverflowActor) {
  const d = actor.distance % 2400;
  return { x: 870 + (d <= 1200 ? d : 2400 - d), y: 970 + actor.lane * 20, mirrored: d > 1200 };
}
