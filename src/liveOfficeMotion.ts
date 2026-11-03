import { advancePersonal, interruptPersonal, personalPose, personalStart, PERSONAL_IDLE_DELAY_MS } from './personalIdle.ts';
import type { PersonalIdle, PersonalRole } from './personalIdle.ts';
import type { OfficeStatus } from './core.ts';
import type { DemoStage } from './demoTimeline.ts';
import { seatingPose } from './demoSeating.ts';

export type LiveOfficePhase = 'arrival' | 'sit' | 'seated' | 'stand' | 'exit' | 'personal';
export interface LiveOfficeTarget {
  id: string;
  /** Full source/instance/epoch identity, not a display name. Null means no current observation. */
  identityKey: string | null;
  seatKey: string;
  status: OfficeStatus;
  personalRole?: PersonalRole;
}
export interface LiveOfficeActor extends LiveOfficeTarget {
  identityKey: string;
  phase: LiveOfficePhase;
  elapsedMs: number;
  personal?: PersonalIdle;
}
export type LiveOfficeMotionState = readonly LiveOfficeActor[];
const durations = { arrival: 4000, sit: 2000, stand: 2000, exit: 4000 } as const;
const active = (status: OfficeStatus) => status !== 'offline' && status !== 'unknown';

/** Missing rows are uncertainty, never evidence of departure. Only explicit offline leaves. */
export function reconcileLiveOffice(previous: LiveOfficeMotionState, targets: readonly LiveOfficeTarget[], reducedMotion = false): LiveOfficeMotionState {
  return targets.flatMap(target => {
    let actor = previous.find(item => item.id === target.id);
    if (actor && target.identityKey && actor.identityKey !== target.identityKey) actor = undefined;
    if (!actor) {
      return target.identityKey && active(target.status)
        ? [{ ...target, identityKey: target.identityKey, phase: reducedMotion ? 'seated' as const : 'arrival' as const, elapsedMs: 0 }]
        : [];
    }
    const next: LiveOfficeActor = { ...actor, ...target, identityKey: target.identityKey ?? actor.identityKey };
    if (target.status === 'unknown') {
      // Cancel unfinished travel rather than showing activity or a fictitious departure.
      return [{ ...next, phase: 'seated', elapsedMs: 0, personal: undefined }];
    }
    if (actor.phase === 'personal' && !reducedMotion && actor.seatKey === target.seatKey && actor.personalRole === target.personalRole) {
      const personal = target.status === 'idle' ? actor.personal : actor.personal && interruptPersonal(actor.personal);
      if (personal) return [{ ...next, personal }];
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
  });
}

export function advanceLiveOffice(previous: LiveOfficeMotionState, deltaMs: number): LiveOfficeMotionState {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return previous;
  return previous.flatMap(actor => {
    if (actor.status === 'unknown') return [actor];
    if (actor.phase === 'personal') {
      const personal = actor.personal && actor.personalRole && advancePersonal(actor.personal, actor.personalRole, deltaMs);
      if (personal) return [{ ...actor, personal }];
      return actor.status === 'offline' ? [{ ...actor, personal: undefined, phase: 'stand', elapsedMs: 0 }] : [{ ...actor, personal: undefined, phase: 'seated', elapsedMs: 0 }];
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
    if (phase === 'seated' && actor.status === 'idle' && actor.personalRole && elapsedMs >= PERSONAL_IDLE_DELAY_MS) {
      return [{ ...actor, phase: 'personal', elapsedMs: 0, personal: personalStart(actor.personalRole) }];
    }
    // Bound the seated animation counter. No demo lifecycle repeats behind live data.
    return [{ ...actor, phase, elapsedMs: phase === 'seated' ? elapsedMs % 234000 : elapsedMs }];
  });
}

export function liveOfficeNeedsClock(actors: LiveOfficeMotionState): boolean {
  return actors.some(actor => actor.status !== 'unknown' && (actor.phase !== 'seated' || actor.status === 'working' || actor.status === 'idle' || actor.status === 'waiting'));
}

export const liveStatusLabels: Record<OfficeStatus, string> = {
  working: '工作中', idle: '待机', waiting: '等待输入', stopping: '停止中', offline: '离线', unknown: '状态未知',
};
export function liveOfficePose(actor: LiveOfficeActor, reducedMotion = false): {
  stage: DemoStage; stageElapsedMs: number; progress: number; label: string; status: OfficeStatus;
  phase: LiveOfficePhase; sheet: 'locomotion' | 'seated' | 'extra'; frame?: number; personal?: PersonalIdle;
} {
  const common = { label: liveStatusLabels[actor.status], status: actor.status, phase: actor.phase, stageElapsedMs: actor.elapsedMs };
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
