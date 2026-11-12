import type { DemoCharacter } from './demoAssets.ts';

/** Approved seated loops only. These are visual idle expressions, not observed activities. */
export const seatedBreakAnimations = {
  chatgpt: { label: '抱盾探头',
    frames: [0, 1, 2, 3, 4, 5, 4, 3, 2, 6, 1, 7],
    durationsMs: [600, 200, 260, 350, 350, 180, 350, 300, 260, 260, 180, 600] },
  deepseek: { label: '抱碗扒饭',
    frames: [0, 1, 2, 3, 4, 3, 4, 3, 4, 5, 6, 1, 7],
    durationsMs: [600, 240, 300, 170, 170, 170, 170, 170, 170, 650, 250, 180, 600] },
  grok: { label: '红茶时间',
    frames: [0, 1, 2, 3, 4, 3, 5, 2, 6, 1, 7],
    durationsMs: [600, 300, 400, 500, 700, 250, 600, 300, 300, 200, 600] },
} as const;
export type SeatedBreakRole = keyof typeof seatedBreakAnimations;
export const SEATED_BREAK_DELAY_MS = 5000;

export function seatedBreakDuration(role: SeatedBreakRole): number {
  return seatedBreakAnimations[role].durationsMs.reduce((sum: number, duration: number) => sum + duration, 0);
}

export function seatedBreakFrame(role: SeatedBreakRole, elapsedMs: number): number {
  const animation = seatedBreakAnimations[role];
  let remaining = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) % seatedBreakDuration(role);
  for (let index = 0; index < animation.frames.length; index++) {
    if (remaining < animation.durationsMs[index]) return animation.frames[index];
    remaining -= animation.durationsMs[index];
  }
  return 0;
}

/** Optional art must be this persona's own loaded sheet; base art never waits for it. */
export function seatedBreakRole(character: DemoCharacter, loaded: readonly string[]): SeatedBreakRole | undefined {
  return (character.id === 'chatgpt' || character.id === 'deepseek' || character.id === 'grok') &&
    character.seatedBreak && loaded.includes(character.seatedBreak.src) ? character.id : undefined;
}
