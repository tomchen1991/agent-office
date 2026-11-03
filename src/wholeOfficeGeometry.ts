import { demoCharacters } from './demoAssets.ts';
import type { DemoCharacter } from './demoAssets.ts';
import type { DemoStage } from './demoTimeline.ts';
import { DEMO_SPRITE_WIDTH_PERCENT, SEATED_CONTACT_Y, seatingPlacement, seatingPose } from './demoSeating.ts';

/** A single shared world. Only furniture and actors use the original scene's calibration. */
export const OFFICE_WORLD = { width: 1400, height: 850 } as const;
export const MAX_SIMULATED_CHILD_SEATS = 3;
export const SIMULATED_CHILD_COUNT = 5;
export type OfficeLayout = 'leader-desks' | 'peer-table';
export interface OfficePoint { x: number; y: number }
export interface OfficeSeat extends OfficePoint {
  id: string;
  persona: DemoCharacter['id'];
  label: string;
  kind: 'owner' | 'team' | 'simulated-child';
  role: string;
  scale: number;
}
const SOURCE_SEAT = { x: 680, y: SEATED_CONTACT_Y * 5.7 };
export function wholeOfficeSeats(layout: OfficeLayout, childCount = SIMULATED_CHILD_COUNT): OfficeSeat[] {
  const seats: OfficeSeat[] = [
    { id: 'self', persona: 'self', label: '自研 Agent', kind: 'owner', role: '独立办公室 · 专属席位', x: 255, y: 300, scale: .88 },
  ];
  for (let index = 0; index < Math.min(MAX_SIMULATED_CHILD_SEATS, Math.max(0, Math.floor(childCount))); index++) {
    seats.push({ id: `self-child-${index + 1}`, persona: 'self', label: `模拟子 Actor ${index + 1}`, kind: 'simulated-child', role: '自研外观派生 · 演示实例', x: 140 + index * 150, y: 580, scale: .42 });
  }
  seats.push(...(layout === 'leader-desks' ? [
    { id: 'chatgpt', persona: 'chatgpt', label: 'ChatGPT', kind: 'team', role: '任务负责人 · 演示指定', x: 995, y: 290, scale: .88 },
    { id: 'deepseek', persona: 'deepseek', label: 'DeepSeek', kind: 'team', role: '团队成员', x: 770, y: 535, scale: .85 },
    { id: 'grok', persona: 'grok', label: 'Grok', kind: 'team', role: '团队成员', x: 1100, y: 535, scale: .85 },
  ] : [
    { id: 'deepseek', persona: 'deepseek', label: 'DeepSeek', kind: 'team', role: '同级协作', x: 735, y: 385, scale: .85 },
    { id: 'chatgpt', persona: 'chatgpt', label: 'ChatGPT', kind: 'team', role: '同级协作', x: 965, y: 385, scale: .85 },
    { id: 'grok', persona: 'grok', label: 'Grok', kind: 'team', role: '同级协作', x: 1195, y: 385, scale: .85 },
  ]) as OfficeSeat[]);
  return seats;
}
/** Transform calibrated source pixels, not differently registered body landmarks. */
export function officeLocalPoint(seat: OfficeSeat, sourceX: number, sourceY: number): OfficePoint {
  return { x: seat.x + (sourceX - SOURCE_SEAT.x) * seat.scale, y: seat.y + (sourceY - SOURCE_SEAT.y) * seat.scale };
}
export function officeApproachPoint(seat: OfficeSeat, character = demoCharacters.find(item => item.id === seat.persona)!): OfficePoint {
  const width = DEMO_SPRITE_WIDTH_PERCENT * 10 * seat.scale;
  // In the whole office, upright feet stay on the same floor as seated feet.
  // The isolated character lab retains its own earlier short approach choreography.
  return { x: seat.x + (character.locomotion.anchor.x - character.seated.anchor.x) * width, y: seat.y + (character.locomotion.anchor.y - character.seated.anchor.y) * width };
}
/** Explicit releases avoid a seven-character pile-up at the shared doorway. */
export function officeTravelTiming(seat: OfficeSeat) {
  const order = ['self', 'chatgpt', 'deepseek', 'grok', 'self-child-1', 'self-child-2', 'self-child-3'];
  const index = Math.max(0, order.indexOf(seat.id));
  const arrivalDelayMs = [0, 300, 600, 900, 1200, 1450, 1700][index];
  return { arrivalDelayMs, arrivalTravelMs: 4000 - arrivalDelayMs - 120, exitDelayMs: index * 200, exitTravelMs: 2800 };
}
/** All private-office paths cross the open partition doorway at y=685, never its wall. */
export function officeRoute(seat: OfficeSeat, character?: DemoCharacter): OfficePoint[] {
  const end = officeApproachPoint(seat, character);
  if (seat.kind !== 'team') {
    const aisleY = seat.kind === 'owner' ? 185 : 470;
    const approachX = seat.x - (seat.kind === 'owner' ? 80 : 55);
    return [{ x: 640, y: 808 }, { x: 640, y: 685 }, { x: 570, y: 685 }, { x: 570, y: aisleY }, { x: approachX, y: aisleY }, { x: approachX, y: end.y }, end];
  }
  const aisleY = seat.y < 320 ? 170 : seat.y < 450 ? 250 : 425;
  return [{ x: 640, y: 808 }, { x: 650, y: 685 }, { x: 650, y: aisleY }, { x: seat.x - 85, y: aisleY }, { x: seat.x - 85, y: end.y }, end];
}
export function pointAlongOfficeRoute(route: readonly OfficePoint[], progress: number): OfficePoint & { movingLeft: boolean } {
  const lengths = route.slice(1).map((point, index) => Math.hypot(point.x - route[index].x, point.y - route[index].y));
  let distance = lengths.reduce((sum, length) => sum + length, 0) * Math.max(0, Math.min(1, progress));
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (distance <= length || index === lengths.length - 1) {
      const from = route[index], to = route[index + 1], t = length === 0 ? 1 : distance / length;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, movingLeft: to.x < from.x };
    }
    distance -= length;
  }
  return { ...route[0], movingLeft: false };
}
export function officeActorPlacement(seat: OfficeSeat, character: DemoCharacter, stage: DemoStage, stageElapsedMs: number, _progress: number, reducedMotion = false) {
  const width = DEMO_SPRITE_WIDTH_PERCENT * 10 * seat.scale;
  if (stage === 'sit' || stage === 'stand') {
    const pose = seatingPose(stage, stageElapsedMs, reducedMotion);
    const placement = seatingPlacement(pose, character.locomotion.anchor, character.seated.anchor);
    // Reuse the approved poses and anchor reflection, but plant the whole-office feet.
    return { ...officeApproachPoint(seat, character), width, contactX: placement.contactX, contactY: placement.contactY, mirrored: pose.mirrored, opacity: 1, motionElapsedMs: stageElapsedMs };
  }
  if (stage !== 'arrival' && stage !== 'exit') {
    return { x: seat.x, y: seat.y, width, contactX: character.seated.anchor.x, contactY: character.seated.anchor.y, mirrored: false, opacity: 1, motionElapsedMs: stageElapsedMs };
  }
  const timing = officeTravelTiming(seat);
  const delay = stage === 'arrival' ? timing.arrivalDelayMs : timing.exitDelayMs;
  const duration = stage === 'arrival' ? timing.arrivalTravelMs : timing.exitTravelMs;
  const elapsed = Math.max(0, Math.min(duration, stageElapsedMs - delay));
  const travelProgress = elapsed / duration;
  // Finish arrival at 3880ms and plant frame 0 for 120ms before the unchanged sit opening.
  // Static mode shows the arrival endpoint / exit start, without animating travel.
  const travel = reducedMotion ? 1 : stage === 'arrival' ? travelProgress : 1 - travelProgress;
  const point = pointAlongOfficeRoute(officeRoute(seat, character), travel);
  const mirrored = stage === 'arrival' ? point.movingLeft : !point.movingLeft;
  const opacity = reducedMotion ? 1 : stage === 'arrival' ? Math.min(1, elapsed / 170) : Math.min(1, (duration - elapsed) / 250);
  return { ...point, width, contactX: mirrored ? 1 - character.locomotion.anchor.x : character.locomotion.anchor.x, contactY: character.locomotion.anchor.y, mirrored, opacity, motionElapsedMs: stage === 'arrival' && elapsed === duration ? 0 : elapsed };
}
/** Depth is measured at the feet, even when a sprite uses a seated contact anchor. */
export function officeActorDepth(placement: ReturnType<typeof officeActorPlacement>, character: DemoCharacter) {
  return Math.round(placement.y + (character.locomotion.anchor.y - placement.contactY) * placement.width);
}
