import { demoCharacters } from './demoAssets.ts';
import type { DemoCharacter } from './demoAssets.ts';
import type { DemoStage } from './demoTimeline.ts';
import { DEMO_SPRITE_WIDTH_PERCENT, SEATED_CONTACT_Y, seatingPlacement, seatingPose } from './demoSeating.ts';

/** A single shared world. Only furniture and actors use the original scene's calibration. */
export const OFFICE_WORLD = { width: 2250, height: 1050 } as const;
export const officeRegionCenters = { private: { x: 325, y: 520 }, public: { x: 1420, y: 320 }, desks: { x: 1420, y: 720 } } as const;
export const MAX_SIMULATED_CHILD_SEATS = 3;
export const SIMULATED_CHILD_COUNT = 5;
export type OfficeLayout = 'independent-desks' | 'leader-desks' | 'peer-table';
export interface OfficePoint { x: number; y: number }
export interface OfficeSeat extends OfficePoint {
  id: string;
  persona: DemoCharacter['id'];
  label: string;
  kind: 'owner' | 'team' | 'simulated-child';
  role: string;
  scale: number;
  /** Only shared-table seats may face inward or use its perimeter aisle. */
  geometryId?: string;
  empty?: boolean;
  tableId?: string;
  mirrored?: boolean;
  sharedTable?: boolean;
}
const SOURCE_SEAT = { x: 680, y: SEATED_CONTACT_Y * 5.7 };
export interface OfficeTable extends OfficePoint {
  id: string; width: number; height: number; depth: number; scale: number; private: boolean;
}
/** The approved continuous shared surface, repeated without changing its shape. */
export const fixedOfficeTables: readonly OfficeTable[] = [
  { id: 'private-table', x: 90, y: 600, width: 412.75, height: 174.2, depth: 724.8, scale: .65, private: true },
  ...[0, 1, 2].map(index => ({ id: `public-table-${index + 1}`, x: 740 + index * 480, y: 245, width: 457.835, height: 193.228, depth: 383.432, scale: .721, private: false })),
];
/** All furniture exists even when no agent is connected. No template is an actor. */
export function fixedOfficeSeats(): OfficeSeat[] {
  const seats: OfficeSeat[] = [{ id: 'self', geometryId: 'self', persona: 'self', label: '主工位', kind: 'owner', role: '独立办公室 · 大工位', x: 250, y: 340, scale: 1.1, empty: true }];
  for (const table of fixedOfficeTables) {
    const offsets = [{ x: 40, y: 89 }, { x: 240, y: 6 }, { x: 580, y: 89, mirrored: true }];
    offsets.forEach((offset, index) => {
      const id = table.private ? `self-child-${index + 1}` : `${table.id}-seat-${index + 1}`;
      seats.push({ id, geometryId: id, persona: 'self', label: `空席 ${index + 1}`, kind: table.private ? 'simulated-child' : 'team', role: table.private ? '办公室协作席' : '公共协作席', x: table.x + offset.x * table.scale, y: table.y + offset.y * table.scale, scale: .85 * table.scale, sharedTable: true, tableId: table.id, mirrored: offset.mirrored, empty: true });
    });
  }
  for (let index = 0; index < 10; index++) {
    const id = `public-desk-${index + 1}`;
    seats.push({ id, geometryId: id, persona: 'self', label: `工位 ${String(index + 1).padStart(2, '0')}`, kind: 'team', role: '公共独立工位', x: 910 + index % 5 * 270, y: 580 + Math.floor(index / 5) * 235, scale: .756, empty: true });
  }
  return seats;
}
/** Compatibility demo occupants. Layout is a collaboration mode, not a floor replacement. */
export function wholeOfficeSeats(layout: OfficeLayout, childCount = SIMULATED_CHILD_COUNT): OfficeSeat[] {
  const templates = fixedOfficeSeats();
  const occupied = (geometryId: string, id: string, persona: DemoCharacter['id'], label: string, role: string): OfficeSeat => ({ ...templates.find(seat => seat.id === geometryId)!, id, persona, label, role, empty: false });
  return [occupied('self', 'self', 'self', '自研 Agent', '独立办公室 · 专属席位'),
    ...Array.from({ length: Math.min(MAX_SIMULATED_CHILD_SEATS, Math.max(0, Math.floor(childCount))) }, (_, index) => occupied(`self-child-${index + 1}`, `self-child-${index + 1}`, 'self', `模拟子 Actor ${index + 1}`, '自研外观派生 · 演示实例')),
    ...(['deepseek', 'chatgpt', 'grok'] as const).map((id, index) => occupied(layout === 'independent-desks' && index > 0 ? `public-desk-${index}` : `public-table-1-seat-${index + 1}`, id, id, id === 'chatgpt' ? 'ChatGPT' : id === 'deepseek' ? 'DeepSeek' : 'Grok', layout === 'leader-desks' && id === 'chatgpt' ? '任务负责人 · 演示指定' : '同级协作'))];
}
/** Transform calibrated source pixels, not differently registered body landmarks. */
export function officeLocalPoint(seat: OfficeSeat, sourceX: number, sourceY: number): OfficePoint {
  return { x: seat.x + (seat.mirrored ? -1 : 1) * (sourceX - SOURCE_SEAT.x) * seat.scale, y: seat.y + (sourceY - SOURCE_SEAT.y) * seat.scale };
}
export function officeApproachPoint(seat: OfficeSeat, character = demoCharacters.find(item => item.id === seat.persona)!): OfficePoint {
  const width = DEMO_SPRITE_WIDTH_PERCENT * 10 * seat.scale;
  // In the whole office, upright feet stay on the same floor as seated feet.
  // The isolated character lab retains its own earlier short approach choreography.
  return { x: seat.x + (seat.mirrored ? -1 : 1) * (character.locomotion.anchor.x - character.seated.anchor.x) * width, y: seat.y + (character.locomotion.anchor.y - character.seated.anchor.y) * width };
}
/** Explicit releases avoid a seven-character pile-up at the shared doorway. */
export function officeTravelTiming(seat: OfficeSeat) {
  const index = Math.max(0, fixedOfficeSeats().findIndex(item => item.id === (seat.geometryId ?? seat.id)));
  const arrivalDelayMs = index * 75;
  return { arrivalDelayMs, arrivalTravelMs: 3880 - arrivalDelayMs, exitDelayMs: index * 50, exitTravelMs: 2800 };
}
/** Routes use the central aisle and the open partition doorway, then each table perimeter. */
export function officeRoute(seat: OfficeSeat, character?: DemoCharacter): OfficePoint[] {
  const end = officeApproachPoint(seat, character);
  const entry = [{ x: 780, y: 1010 }, { x: 780, y: 980 }];
  if (seat.sharedTable) {
    const table = fixedOfficeTables.find(item => item.id === seat.tableId)!;
    const perimeterX = seat.mirrored ? table.x + table.width + 12 : seat.x - (table.private ? 0 : 25);
    const aisleY = table.y - 110;
    return [...entry, ...(table.private ? [{ x: 518, y: 980 }, { x: 518, y: aisleY }] : [{ x: 735, y: 980 }, { x: 735, y: aisleY }]), { x: perimeterX, y: aisleY }, { x: perimeterX, y: end.y }, end];
  }
  const aisleY = seat.y - (seat.kind === 'owner' ? 120 : 100);
  return [...entry, ...(seat.kind === 'owner' ? [{ x: 518, y: 980 }, { x: 518, y: aisleY }] : [{ x: 750, y: 980 }, { x: 750, y: aisleY }]), { x: seat.x - (seat.kind === 'owner' ? 60 : 80), y: aisleY }, { x: seat.x - (seat.kind === 'owner' ? 60 : 80), y: end.y }, end];
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
    // Reflect pose and registered anchor together; never flip the visual alone.
    const mirrored = Boolean(seat.mirrored) !== pose.mirrored;
    return { ...officeApproachPoint(seat, character), width, contactX: mirrored ? 1 - character.locomotion.anchor.x : character.locomotion.anchor.x, contactY: placement.contactY, mirrored, opacity: 1, motionElapsedMs: stageElapsedMs };
  }
  if (stage !== 'arrival' && stage !== 'exit') {
    return { x: seat.x, y: seat.y, width, contactX: seat.mirrored ? 1 - character.seated.anchor.x : character.seated.anchor.x, contactY: character.seated.anchor.y, mirrored: Boolean(seat.mirrored), opacity: 1, motionElapsedMs: stageElapsedMs };
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
