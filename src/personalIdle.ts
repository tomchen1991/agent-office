import { seatingPose } from './demoSeating.ts';
import type { DemoStage } from './demoTimeline.ts';
import type { DemoCharacter } from './demoAssets.ts';
import { officeActorWidth, officeApproachPoint, pointAlongOfficeRoute } from './wholeOfficeGeometry.ts';
import type { OfficeSeat } from './wholeOfficeGeometry.ts';
export type PersonalRole = 'self' | 'github';
export type PersonalPhase = 'game' | 'rise' | 'out' | 'pickup' | 'scythe' | 'putdown' | 'back' | 'settle';
export interface PersonalIdle {
  phase: PersonalPhase; elapsedMs: number; returnFrom?: number;
  /** Latched recall deadline in the existing scythe clock; survives freeze/reconcile. */
  scytheReturnAtMs?: number;
}
export const PERSONAL_IDLE_DELAY_MS = 5000;
export const PERSONAL_IDLE_DURATION_MS = 11000;
export const personalDuration: Record<PersonalPhase, number> = { game: 2600, rise: 2000, out: 1200, pickup: 1000, scythe: 2600, putdown: 1000, back: 1200, settle: 2000 };
export function personalStart(role: PersonalRole): PersonalIdle { return { phase: role === 'self' ? 'rise' : 'game', elapsedMs: 0 }; }
export function personalRouteProgress(action: PersonalIdle): number {
  return action.phase === 'out' ? Math.min(1, action.elapsedMs / 1200) : ['pickup', 'scythe', 'putdown'].includes(action.phase) ? 1
    : action.phase === 'back' ? (action.returnFrom ?? 1) * (1 - Math.min(1, action.elapsedMs / 1200)) : 0;
}
export function interruptPersonal(action: PersonalIdle): PersonalIdle | undefined {
  if (action.phase === 'game') return undefined;
  if (action.phase === 'scythe') {
    if (action.scytheReturnAtMs !== undefined) return action;
    // At the initial grip we can reverse immediately. Once spinning, finish
    // this revolution, show its zero angle, then restore the exact handoff grip.
    if (action.elapsedMs < 100) return { phase: 'putdown', elapsedMs: 0 };
    const scytheReturnAtMs = action.elapsedMs < 1700
      ? 100 + Math.ceil((action.elapsedMs - 100) / 800) * 800 + 200
      : action.elapsedMs < 1900 ? 1900 : personalDuration.scythe;
    return { ...action, scytheReturnAtMs };
  }
  if (action.phase === 'pickup') return { phase: 'putdown', elapsedMs: Math.max(0, 999 - action.elapsedMs) };
  if (action.phase === 'putdown' || action.phase === 'back' || action.phase === 'settle') return action;
  if (action.phase === 'rise') return { phase: 'settle', elapsedMs: Math.max(0, 2000 - action.elapsedMs) };
  return { phase: 'back', elapsedMs: 0, returnFrom: personalRouteProgress(action) };
}
export function advancePersonal(action: PersonalIdle, role: PersonalRole, deltaMs: number): PersonalIdle | undefined {
  let next = { ...action, elapsedMs: action.elapsedMs + deltaMs };
  const sequence: PersonalPhase[] = role === 'self' ? ['rise', 'out', 'pickup', 'scythe', 'putdown', 'back', 'settle'] : ['game', 'rise', 'out', 'back', 'settle'];
  const duration = (value: PersonalIdle) => value.phase === 'scythe' ? value.scytheReturnAtMs ?? personalDuration.scythe : personalDuration[value.phase];
  while (next.elapsedMs >= duration(next)) {
    const elapsedMs = next.elapsedMs - duration(next);
    const phase = sequence[sequence.indexOf(next.phase) + 1];
    if (!phase) return undefined;
    next = { phase, elapsedMs };
  }
  return next;
}
export function personalDemo(role: PersonalRole, elapsedMs: number): PersonalIdle | undefined { return advancePersonal(personalStart(role), role, elapsedMs); }
export function personalPose(action: PersonalIdle): { stage: DemoStage; stageElapsedMs: number; progress: number; sheet: 'seated' | 'locomotion' | 'extra' | 'pickup'; frame: number; personal: PersonalIdle } {
  const base = { stageElapsedMs: action.elapsedMs, progress: 0, personal: action };
  if (action.phase === 'pickup' || action.phase === 'putdown') return { ...base, stage: 'slack', sheet: 'pickup', frame: pickupFrame(action) };
  if (action.phase === 'scythe') return { ...base, stage: 'slack', sheet: 'extra', frame: scytheFrame(action) };
  if (action.phase === 'game') return { ...base, stage: 'slack', sheet: 'extra', frame: Math.floor(action.elapsedMs / 325) % 4 };
  if (action.phase === 'rise' || action.phase === 'settle') {
    const stage = action.phase === 'rise' ? 'stand' : 'sit';
    const pose = seatingPose(stage, action.elapsedMs);
    return { ...base, stage, sheet: pose.sheet, frame: pose.sheet === 'seated' ? 6 : pose.frame };
  }
  return { ...base, stage: 'slack', sheet: 'locomotion', frame: Math.floor(action.elapsedMs / 160) % 4 };
}
/** Short routes stay beside each dedicated desk; no shared aisle tour. */
export function personalRoute(seat: OfficeSeat, character: DemoCharacter) {
  const home = officeApproachPoint(seat, character);
  if (seat.kind === 'owner') return [home, { x: seat.x + 245, y: home.y }, { x: seat.x + 245, y: seat.y + 190 }];
  const sideX = seat.x - 80;
  return [home, { x: sideX, y: home.y }, { x: sideX, y: seat.y - (seat.kind === 'github' ? 0 : 60) }];
}
export function personalPlacement(seat: OfficeSeat, character: DemoCharacter, action: PersonalIdle) {
  const point = pointAlongOfficeRoute(personalRoute(seat, character), personalRouteProgress(action));
  const atStand = ['pickup', 'scythe', 'putdown'].includes(action.phase);
  const mirrored = atStand ? false : action.phase === 'back' ? !point.movingLeft : point.movingLeft;
  const anchor = atStand ? character.extra?.anchor ?? character.locomotion.anchor : character.locomotion.anchor;
  return { x: point.x, y: point.y, width: officeActorWidth(seat), contactX: mirrored ? 1 - anchor.x : anchor.x, contactY: anchor.y, mirrored, opacity: 1, motionElapsedMs: action.elapsedMs };
}

/** The only ownership switch occurs at contact, between pickup frames 1 and 2. */
export function pickupFrame(action: PersonalIdle): number {
  const forward = Math.min(3, Math.floor(action.elapsedMs / 250));
  return action.phase === 'putdown' ? 3 - forward : forward;
}
export function scytheOwnership(action?: PersonalIdle): 'parked' | 'handoff' | 'held' | 'returning' {
  if (!action) return 'parked';
  if (action.phase === 'scythe') return 'held';
  if (action.phase === 'pickup') return pickupFrame(action) >= 2 ? 'held' : 'handoff';
  if (action.phase === 'putdown') return pickupFrame(action) >= 2 ? 'returning' : 'handoff';
  return 'parked';
}
export function actorHasScythe(action?: PersonalIdle): boolean {
  const owner = scytheOwnership(action);
  return owner === 'held' || owner === 'returning';
}
export function personalAssets(character: DemoCharacter): string[] {
  return [character.extra?.src, ...(character.id === 'self' ? [character.pickup?.src, character.parkedScythe?.src] : [])].filter((src): src is string => Boolean(src));
}
export function personalAssetsReady(character: DemoCharacter, loaded: readonly string[]): boolean {
  return Boolean(character.extra && (character.id !== 'self' || (character.pickup && character.parkedScythe))) && personalAssets(character).every(src => loaded.includes(src));
}

/** Two complete clockwise revolutions, a visible pose, then the pickup's exact grip.
 * Frames 0..7 are authored weapon directions, 8 is the handoff, 9 is wink/V.
 * Never rotate the whole actor with CSS or loop the old four-frame swing.
 */
export function scytheFrame(action: PersonalIdle): number {
  const ms = action.elapsedMs;
  if (action.scytheReturnAtMs !== undefined && action.scytheReturnAtMs <= 1900) {
    if (ms >= action.scytheReturnAtMs - 100) return 8;
    if (ms >= action.scytheReturnAtMs - 200) return 0;
  }
  if (ms < 100) return 8;
  if (ms < 1700) return Math.floor((ms - 100) / 100) % 8;
  if (ms < 1800) return 0;
  if (ms < 1900 || ms >= 2400) return 8;
  return 9;
}
