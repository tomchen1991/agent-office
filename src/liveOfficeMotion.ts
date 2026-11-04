import { NIGHT_LOWER_MS, NIGHT_WAKE_MS } from './nightRest.ts';
import { advancePersonal, interruptPersonal, personalPose, personalStart, PERSONAL_IDLE_DELAY_MS } from './personalIdle.ts';
import type { PersonalIdle, PersonalRole } from './personalIdle.ts';
import type { OfficeStatus } from './core.ts';
import type { DemoStage } from './demoTimeline.ts';
import { seatingPose } from './demoSeating.ts';

export type LiveOfficePhase = 'arrival' | 'sit' | 'seated' | 'stand' | 'exit' | 'personal' | 'drowse' | 'sleep' | 'wake';
export interface LiveOfficeTarget {
  id: string;
  /** Full source/instance/epoch identity, not a display name. Null means no current observation. */
  identityKey: string | null;
  seatKey: string;
  status: OfficeStatus;
  personalRole?: PersonalRole;
  /** Only dedicated self/github, fresh connected explicit idle, loaded own sleep art. */
  nightEligible?: boolean;
  /** Night suppresses daytime leisure even if optional sleep artwork is unavailable. */
  nightRest?: boolean;
  nightArtReady?: boolean;
  nightArtKey?: string;
}
export interface LiveOfficeActor extends LiveOfficeTarget {
  identityKey: string;
  phase: LiveOfficePhase;
  elapsedMs: number;
  personal?: PersonalIdle;
  frozen?: boolean;
  /** A retained visual finishing a prop return, never the new instance's work. */
  visualOnly?: boolean;
  pendingTarget?: LiveOfficeTarget;
}
export type LiveOfficeMotionState = readonly LiveOfficeActor[];
const durations = { arrival: 4000, sit: 2000, stand: 2000, exit: 4000 } as const;
const active = (status: OfficeStatus) => status !== 'offline' && status !== 'unknown';

/** Missing rows are uncertainty, never evidence of departure. Only explicit offline leaves. */
export function reconcileLiveOffice(previous: LiveOfficeMotionState, targets: readonly LiveOfficeTarget[], reducedMotion = false): LiveOfficeMotionState {
  const reserved = previous.find(item => item.personalRole === 'self' && item.phase === 'personal');
  const consumed = new Set<LiveOfficeActor>();
  return targets.flatMap<LiveOfficeActor>(target => {
    // Reserve a weapon bearer for its physical owner slot. A topology remap may
    // reuse the old id elsewhere; it must not clone the same visual into two seats.
    let actor = reserved?.seatKey === target.seatKey && !consumed.has(reserved) ? reserved
      : previous.find(item => item !== reserved && item.id === target.id && !consumed.has(item));
    if (actor) consumed.add(actor);
    // Weapon ownership outlives a collector epoch. Finish the old visual safely
    // before admitting a replacement; never claim that visual is working.
    if (actor?.phase === 'personal' && actor.personalRole === 'self' && actor.personal &&
        (actor.visualOnly || actor.personalRole !== target.personalRole || (target.identityKey && actor.identityKey !== target.identityKey) || actor.seatKey !== target.seatKey)) {
      const frozen = reducedMotion || target.status === 'unknown' || !target.identityKey;
      return [{ ...actor, id: target.id, status: 'unknown' as const, visualOnly: true, pendingTarget: target,
        frozen, personal: frozen ? actor.personal : interruptPersonal(actor.personal) }];
    }
    if (actor && target.identityKey && actor.identityKey !== target.identityKey) actor = undefined;
    if (!actor) {
      return target.identityKey && active(target.status)
        ? [{ ...target, identityKey: target.identityKey, phase: reducedMotion ? 'seated' as const : 'arrival' as const, elapsedMs: 0 }]
        : [];
    }
    const next: LiveOfficeActor = { ...actor, ...target, personalRole: target.personalRole, identityKey: target.identityKey ?? actor.identityKey };
    if (actor.phase === 'personal' && actor.personalRole === 'self' && actor.personal && (target.status === 'unknown' || reducedMotion)) {
      return [{ ...next, personalRole: 'self' as const, frozen: true }];
    }
    next.frozen = false;
    if (actor.phase === 'drowse' || actor.phase === 'sleep' || actor.phase === 'wake') {
      if (target.status === 'unknown' || !target.identityKey || target.nightArtReady === false || actor.nightArtKey !== target.nightArtKey || reducedMotion || actor.seatKey !== target.seatKey) {
        return target.status === 'offline' ? [] : [{ ...next, phase: 'seated', elapsedMs: 0, personal: undefined }];
      }
      // A wake is latched: repeated idle/work/time changes cannot replay or cancel it.
      if (actor.phase === 'wake') return [next];
      if (!target.nightEligible || target.status !== 'idle') return [{ ...next, phase: 'wake', elapsedMs: actor.phase === 'drowse' ? 450 - Math.min(2, Math.floor(actor.elapsedMs / 300)) * 150 : 0 }];
      return [next];
    }
    if (target.status === 'unknown') {
      // Cancel unfinished travel rather than showing activity or a fictitious departure.
      return [{ ...next, phase: 'seated', elapsedMs: 0, personal: undefined }];
    }
    if (actor.phase === 'personal' && !reducedMotion && actor.seatKey === target.seatKey && (actor.personalRole === target.personalRole || actor.personalRole === 'self')) {
      const personal = target.status === 'idle' && !target.nightRest ? actor.personal : actor.personal && interruptPersonal(actor.personal);
      if (personal) return [{ ...next, personalRole: actor.personalRole, personal }];
      actor = { ...actor, phase: 'seated', personal: undefined, elapsedMs: 0 };
      next.phase = 'seated'; next.personal = undefined; next.elapsedMs = 0;
    }
    if (target.status === 'offline') {
      if (reducedMotion || actor.phase === 'arrival' || actor.phase === 'sit') return [];
      return [{ ...next, phase: actor.phase === 'stand' || actor.phase === 'exit' ? actor.phase : 'stand', elapsedMs: actor.phase === 'stand' || actor.phase === 'exit' ? actor.elapsedMs : 0 }];
    }
    if (reducedMotion || (actor.phase === 'personal' && actor.personalRole !== target.personalRole) || actor.seatKey !== target.seatKey || actor.phase === 'stand' || actor.phase === 'exit') {
      // New layout / return interrupts the old route. Never retain a second ghost actor.
      return [{ ...next, phase: 'seated', elapsedMs: 0, personal: undefined }];
    }
    if (next.phase === 'seated' && actor.status !== target.status) next.elapsedMs = 0;
    return [next];
  }).concat(previous.filter(actor => actor.personalRole === 'self' && actor.phase === 'personal' &&
    !consumed.has(actor))
    .map(actor => ({ ...actor, id: targets.some(target => target.id === actor.id) ? `scythe-return:${actor.identityKey}` : actor.id, status: 'unknown' as const, frozen: true, visualOnly: true })));
}

export function advanceLiveOffice(previous: LiveOfficeMotionState, deltaMs: number): LiveOfficeMotionState {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return previous;
  return previous.flatMap(actor => {
    if (actor.frozen || (actor.status === 'unknown' && !actor.visualOnly)) return [actor];
    if (actor.phase === 'personal') {
      if (actor.personal?.phase === 'game' && actor.status === 'idle' && !actor.nightRest) {
        return [{ ...actor, personal: { phase: 'game', elapsedMs: (actor.personal.elapsedMs + deltaMs) % 1300 } }];
      }
      const personal = actor.personal && actor.personalRole && advancePersonal(actor.personal, actor.personalRole, deltaMs);
      if (personal) return [{ ...actor, personal }];
      if (actor.visualOnly) {
        return actor.pendingTarget ? reconcileLiveOffice([], [actor.pendingTarget]) : [];
      }
      return actor.status === 'offline' ? [{ ...actor, personal: undefined, phase: 'stand', elapsedMs: 0 }] : [{ ...actor, personal: undefined, phase: 'seated', elapsedMs: 0 }];
    }
    if (actor.phase === 'drowse') {
      const elapsedMs = actor.elapsedMs + deltaMs;
      return [{ ...actor, phase: elapsedMs >= NIGHT_LOWER_MS ? 'sleep' : 'drowse', elapsedMs: elapsedMs >= NIGHT_LOWER_MS ? (elapsedMs - NIGHT_LOWER_MS) % 2400 : elapsedMs }];
    }
    if (actor.phase === 'sleep') return [{ ...actor, elapsedMs: (actor.elapsedMs + deltaMs) % 2400 }];
    if (actor.phase === 'wake') {
      const elapsedMs = actor.elapsedMs + deltaMs;
      if (elapsedMs < NIGHT_WAKE_MS) return [{ ...actor, elapsedMs }];
      return actor.status === 'offline' ? [{ ...actor, phase: 'stand', elapsedMs: 0 }] : [{ ...actor, phase: 'seated', elapsedMs: 0 }];
    }
    let elapsedMs = actor.elapsedMs + deltaMs;
    let phase = actor.phase;
    while (phase !== 'seated' && elapsedMs >= durations[phase]) {
      elapsedMs -= durations[phase];
      if (phase === 'arrival') phase = 'sit';
      else if (phase === 'sit') phase = 'seated';
      else if (phase === 'stand') phase = 'exit';
      else return [];
    }
    if (phase === 'seated' && actor.status === 'idle' && actor.nightEligible && elapsedMs >= PERSONAL_IDLE_DELAY_MS) {
      return [{ ...actor, phase: 'drowse', elapsedMs: 0 }];
    }
    if (phase === 'seated' && actor.status === 'idle' && !actor.nightRest && actor.personalRole && elapsedMs >= PERSONAL_IDLE_DELAY_MS) {
      return [{ ...actor, phase: 'personal', elapsedMs: 0, personal: actor.personalRole === 'self' ? personalStart('self') : { phase: 'game', elapsedMs: 0 } }];
    }
    // Bound the seated animation counter. No demo lifecycle repeats behind live data.
    return [{ ...actor, phase, elapsedMs: phase === 'seated' ? elapsedMs % 234000 : elapsedMs }];
  });
}

export function liveOfficeNeedsClock(actors: LiveOfficeMotionState): boolean {
  return actors.some(actor => !actor.frozen && (actor.status !== 'unknown' || actor.visualOnly) && (actor.phase !== 'seated' || actor.status === 'working' || actor.status === 'idle' || actor.status === 'waiting'));
}

export const liveStatusLabels: Record<OfficeStatus, string> = {
  working: '工作中', idle: '待机', waiting: '等待输入', stopping: '停止中', offline: '离线', unknown: '状态未知',
};
export function liveOfficePose(actor: LiveOfficeActor, reducedMotion = false): {
  stage: DemoStage; stageElapsedMs: number; progress: number; label: string; status: OfficeStatus;
  phase: LiveOfficePhase; sheet: 'locomotion' | 'seated' | 'extra' | 'pickup' | 'sleep'; frame?: number; personal?: PersonalIdle;
} {
  const common = { label: liveStatusLabels[actor.status], status: actor.status, phase: actor.phase, stageElapsedMs: actor.elapsedMs };
  if (actor.phase === 'drowse' || actor.phase === 'sleep' || actor.phase === 'wake') {
    const frame = actor.phase === 'drowse' ? Math.min(2, Math.floor(actor.elapsedMs / 300))
      : actor.phase === 'sleep' ? 3 + Math.floor(actor.elapsedMs / 1200) % 2
      : 4 + Math.min(3, Math.floor(actor.elapsedMs / 150));
    return { ...common, label: actor.phase === 'wake' ? `${common.label}，正在醒来` : '待机，夜间伏桌休息（服务持续运行）', stage: 'work', progress: 0, sheet: 'sleep', frame };
  }
  if (actor.phase === 'personal' && actor.personal) return { ...common, ...personalPose(actor.personal) };
  if (actor.phase === 'arrival' || actor.phase === 'exit') return {
    ...common, stage: actor.phase, progress: actor.elapsedMs / durations[actor.phase], sheet: 'locomotion',
  };
  if (actor.phase === 'sit' || actor.phase === 'stand') {
    const pose = seatingPose(actor.phase, actor.elapsedMs, reducedMotion);
    // Demo stand starts on error frame 5; live departure must never invent an error.
    const frame = actor.phase === 'stand' && pose.sheet === 'seated' ? 6 : pose.frame;
    // Demo sit ends on work frame 0; settle in the actual newest state instead.
    const settled = actor.phase === 'sit' && pose.sheet === 'seated' && actor.elapsedMs >= 1680;
    return { ...common, stage: actor.phase, progress: actor.elapsedMs / durations[actor.phase], sheet: pose.sheet,
      frame: settled && actor.status !== 'working' ? 6 : frame };
  }
  const frame = actor.status === 'working' ? (reducedMotion ? 0 : Math.floor(actor.elapsedMs / 260) % 2)
    : actor.status === 'idle' || actor.status === 'waiting' ? 6 + (reducedMotion ? 0 : Math.floor(actor.elapsedMs / 900) % 2) : 6;
  return { ...common, stage: 'work', progress: 0, sheet: 'seated', frame };
}
