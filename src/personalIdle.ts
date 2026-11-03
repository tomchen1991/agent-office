import { seatingPose } from './demoSeating.ts';
import type { DemoStage } from './demoTimeline.ts';
import type { DemoCharacter } from './demoAssets.ts';
import { officeActorWidth, officeApproachPoint, pointAlongOfficeRoute } from './wholeOfficeGeometry.ts';
import type { OfficeSeat } from './wholeOfficeGeometry.ts';
export type PersonalRole = 'self' | 'github';
export type PersonalPhase = 'game' | 'rise' | 'out' | 'scythe' | 'back' | 'settle';
export interface PersonalIdle { phase: PersonalPhase; elapsedMs: number; returnFrom?: number }
export const PERSONAL_IDLE_DELAY_MS = 5000;
export const PERSONAL_IDLE_DURATION_MS = 9000;
export const personalDuration: Record<PersonalPhase, number> = { game: 2600, rise: 2000, out: 1200, scythe: 2600, back: 1200, settle: 2000 };
export function personalStart(role: PersonalRole): PersonalIdle { return { phase: role === 'self' ? 'rise' : 'game', elapsedMs: 0 }; }
export function personalRouteProgress(action: PersonalIdle): number {
  return action.phase === 'out' ? Math.min(1, action.elapsedMs / 1200) : action.phase === 'scythe' ? 1
    : action.phase === 'back' ? (action.returnFrom ?? 1) * (1 - Math.min(1, action.elapsedMs / 1200)) : 0;
}
export function interruptPersonal(action: PersonalIdle): PersonalIdle | undefined {
  if (action.phase === 'game') return undefined;
  if (action.phase === 'back' || action.phase === 'settle') return action;
  if (action.phase === 'rise') return { phase: 'settle', elapsedMs: Math.max(0, 2000 - action.elapsedMs) };
  return { phase: 'back', elapsedMs: 0, returnFrom: personalRouteProgress(action) };
}
export function advancePersonal(action: PersonalIdle, role: PersonalRole, deltaMs: number): PersonalIdle | undefined {
  let next = { ...action, elapsedMs: action.elapsedMs + deltaMs };
  const sequence: PersonalPhase[] = role === 'self' ? ['rise', 'out', 'scythe', 'back', 'settle'] : ['game', 'rise', 'out', 'back', 'settle'];
  while (next.elapsedMs >= personalDuration[next.phase]) {
    const elapsedMs = next.elapsedMs - personalDuration[next.phase];
    const phase = sequence[sequence.indexOf(next.phase) + 1];
    if (!phase) return undefined;
    next = { phase, elapsedMs };
  }
  return next;
}
export function personalDemo(role: PersonalRole, elapsedMs: number): PersonalIdle | undefined { return advancePersonal(personalStart(role), role, elapsedMs); }
export function personalPose(action: PersonalIdle): { stage: DemoStage; stageElapsedMs: number; progress: number; sheet: 'seated' | 'locomotion' | 'extra'; frame: number; personal: PersonalIdle } {
  const base = { stageElapsedMs: action.elapsedMs, progress: 0, personal: action };
  if (action.phase === 'game' || action.phase === 'scythe') return { ...base, stage: 'slack', sheet: 'extra', frame: Math.floor(action.elapsedMs / 325) % 4 };
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
  const mirrored = action.phase === 'scythe' ? false : action.phase === 'back' ? !point.movingLeft : point.movingLeft;
  const anchor = action.phase === 'scythe' ? character.extra?.anchor ?? character.locomotion.anchor : character.locomotion.anchor;
  return { x: point.x, y: point.y, width: officeActorWidth(seat), contactX: mirrored ? 1 - anchor.x : anchor.x, contactY: anchor.y, mirrored, opacity: 1, motionElapsedMs: action.elapsedMs };
}
