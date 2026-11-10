import type { OfficePersona } from './residentVisuals.ts';
import { MAX_VISIBLE_CHILD_AGENTS } from './core.ts';
import { demoCharacters } from './demoAssets.ts';
import type { DemoCharacter } from './demoAssets.ts';
import type { DemoStage } from './demoTimeline.ts';
import { DEMO_SPRITE_WIDTH_PERCENT, SEATED_CONTACT_Y, seatingPlacement, seatingPose } from './demoSeating.ts';

/** Actor-only enlargement. Furniture/world/camera scales remain independent. */
export const OFFICE_ACTOR_RATIO = 1.25;
export const officeActorWidth = (seat: OfficeSeat) => DEMO_SPRITE_WIDTH_PERCENT * 10 * seat.scale * OFFICE_ACTOR_RATIO;
export const OFFICE_DESK = { backX: 610, backWidth: 277, frontX: 600, frontWidth: 297 } as const;
export const OFFICE_WORLD = { width: 2550, height: 1050 } as const;
export const officeRegionCenters = { private: { x: 325, y: 520 }, public: { x: 1420, y: 320 }, desks: { x: 1520, y: 800 }, devops: { x: 2110, y: 380 } } as const;
export const MAX_SIMULATED_CHILD_SEATS = MAX_VISIBLE_CHILD_AGENTS;
export const SIMULATED_CHILD_COUNT = 5;
export type OfficeLayout = 'independent-desks' | 'leader-desks' | 'peer-table';
export interface OfficePoint { x: number; y: number }
export interface OfficeSeat extends OfficePoint {
  id: string;
  persona: OfficePersona;
  label: string;
  kind: 'owner' | 'team' | 'simulated-child' | 'github' | 'devops' | 'hotspot';
  residentRole?: 'main' | 'auto-fix' | 'devops' | 'hotspot';
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
/** Continuous three-seat surface: horizontal excess trimmed, original height retained. */
export const fixedOfficeTables: readonly OfficeTable[] = [
  ...[0, 1].map(index => ({ id: `public-table-${index + 1}`, x: 800 + index * 460, y: 245, width: 412.0515, height: 193.228, depth: 383.432, scale: .721, private: false })),
];
/** All furniture exists even when no agent is connected. No template is an actor. */
export function fixedOfficeSeats(): OfficeSeat[] {
  const seats: OfficeSeat[] = [{ id: 'self', geometryId: 'self', persona: 'self', label: '主工位', kind: 'owner', residentRole: 'main', role: '独立办公室 · 大工位', x: 250, y: 340, scale: 1.1, empty: true }];
  for (let index = 0; index < MAX_SIMULATED_CHILD_SEATS; index++) {
    const id = `self-child-${index + 1}`;
    seats.push({ id, geometryId: id, persona: 'self', label: `子工位 ${index + 1}`, kind: 'simulated-child', role: '子 Agent 独立工位', x: 250, y: 600 + index * 235, scale: .756, empty: true });
  }
  for (const table of fixedOfficeTables) {
    const offsets = [{ x: 40, y: 89 }, { x: 240, y: 6 }, { x: 580, y: 89, mirrored: true }];
    offsets.forEach((offset, index) => {
      const id = table.private ? `self-child-${index + 1}` : `${table.id}-seat-${index + 1}`;
      seats.push({ id, geometryId: id, persona: 'self', label: `空席 ${index + 1}`, kind: table.private ? 'simulated-child' : 'team', role: table.private ? '办公室协作席' : '公共协作席', x: table.x + offset.x * table.scale * .9 + (index === 2 ? -12 : 20), y: table.y + offset.y * table.scale, scale: .85 * table.scale, sharedTable: true, tableId: table.id, mirrored: offset.mirrored, empty: true });
    });
  }
  for (let index = 0; index < 10; index++) {
    const id = `public-desk-${index + 1}`;
    seats.push({ id, geometryId: id, persona: 'self', label: `工位 ${String(index + 1).padStart(2, '0')}`, kind: 'team', role: '公共独立工位', x: 910 + index % 5 * 270, y: 650 + Math.floor(index / 5) * 235, scale: .756, empty: true });
  }
  seats.push({ id: 'github-desk', geometryId: 'github-desk', persona: 'unknown', label: 'Auto-fix', kind: 'github', residentRole: 'auto-fix', role: '自动修复 · DevOps 办公室', x: 1850, y: 460, scale: .95, empty: true });
  seats.push({ id: 'devops-desk', geometryId: 'devops-desk', persona: 'unknown', label: 'DevOps', kind: 'devops', residentRole: 'devops', role: '服务运维 · DevOps 办公室', x: 2220, y: 460, scale: .95, empty: true });
  seats.push({ id: 'hotspot-desk', geometryId: 'hotspot-desk', persona: 'unknown', label: '热点追踪', kind: 'hotspot', residentRole: 'hotspot', role: '热点追踪 · 公共办公室', x: 2280, y: 840, scale: .9, empty: true });
  return seats;
}
/** Compatibility demo occupants. Layout is a collaboration mode, not a floor replacement. */
export function wholeOfficeSeats(layout: OfficeLayout, childCount = SIMULATED_CHILD_COUNT, includeGithub = true): OfficeSeat[] {
  const templates = fixedOfficeSeats();
  const occupied = (geometryId: string, id: string, persona: DemoCharacter['id'], label: string, role: string): OfficeSeat => ({ ...templates.find(seat => seat.id === geometryId)!, id, persona, label, role, empty: false });
  return [occupied('devops-desk', 'devops-demo', 'devops', 'DevOps · 模拟', '服务运维 · 模拟角色'), occupied('hotspot-desk', 'hotspot-demo', 'hotspot', '热点追踪 · 模拟', '热点追踪 · 模拟角色'), ...(includeGithub ? [occupied('github-desk', 'github-demo', 'github', 'GitHub Agent · 模拟', '修复 / 审核 · 专属大桌')] : []), occupied('self', 'self', 'self', '自研 Agent', '独立办公室 · 专属席位'),
    ...Array.from({ length: Math.min(MAX_SIMULATED_CHILD_SEATS, Math.max(0, Math.floor(childCount))) }, (_, index) => occupied(`self-child-${index + 1}`, `self-child-${index + 1}`, 'self', `模拟子 Actor ${index + 1}`, '自研外观派生 · 演示实例')),
    ...(['deepseek', 'chatgpt', 'grok'] as const).map((id, index) => occupied(layout === 'independent-desks' && index > 0 ? `public-desk-${index}` : `public-table-1-seat-${index + 1}`, id, id, id === 'chatgpt' ? 'ChatGPT' : id === 'deepseek' ? 'DeepSeek' : 'Grok', layout === 'leader-desks' && id === 'chatgpt' ? '任务负责人 · 演示指定' : '同级协作'))];
}
/** Transform calibrated source pixels, not differently registered body landmarks. */
export function officeLocalPoint(seat: OfficeSeat, sourceX: number, sourceY: number): OfficePoint {
  return { x: seat.x + (seat.mirrored ? -1 : 1) * (sourceX - SOURCE_SEAT.x) * seat.scale, y: seat.y + (sourceY - SOURCE_SEAT.y) * seat.scale };
}
export function officeApproachPoint(seat: OfficeSeat, character = demoCharacters.find(item => item.id === seat.persona) ?? demoCharacters[0]): OfficePoint {
  const width = officeActorWidth(seat);
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
  // Both residents enter the DevOps room through its bottom-left doorway.
  if (seat.kind === 'github' || seat.kind === 'devops') return [...entry, { x: 840, y: 980 }, { x: 840, y: 600 }, { x: 1738, y: 600 }, { x: 1738, y: 340 }, { x: seat.x - 80, y: 340 }, { x: seat.x - 80, y: end.y }, end];
  if (seat.kind === 'hotspot') return [...entry, { x: 780, y: 1020 }, { x: 2180, y: 1020 }, { x: 2180, y: 740 }, { x: seat.x - 80, y: 740 }, { x: seat.x - 80, y: end.y }, end];
  if (seat.sharedTable) {
    const table = fixedOfficeTables.find(item => item.id === seat.tableId)!;
    const perimeterX = seat.mirrored ? table.x + table.width + 12 : seat.x - (table.private ? 0 : 25);
    const aisleY = table.y - 70;
    return [...entry, ...(table.private ? [{ x: 486, y: 980 }, { x: 486, y: aisleY }] : [{ x: 780, y: 980 }, { x: 780, y: aisleY }]), { x: perimeterX, y: aisleY }, { x: perimeterX, y: end.y }, end];
  }
  const privateSeat = seat.kind === 'owner' || seat.kind === 'simulated-child';
  const aisleY = seat.y - (privateSeat ? 60 : seat.y === 650 ? 40 : 100);
  return [...entry, ...(privateSeat ? [{ x: 486, y: 980 }, { x: 486, y: aisleY }] : [{ x: 780, y: 980 }, { x: 780, y: aisleY }]), { x: seat.x - (privateSeat ? 30 : 80), y: aisleY }, { x: seat.x - (privateSeat ? 30 : 80), y: end.y }, end];
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
  const width = officeActorWidth(seat);
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
