/** Asset slots for future authored sprite sequences. Translation is NOT walking artwork. */
export type MotionSlotName = 'idle' | 'active' | 'stopping' | 'unknown' | 'arrival' | 'move' | 'departure';
export interface MotionSlot {
  staticSource: string;
  animatedSource?: string;
  authoredAction: boolean;
  description: string;
}
export type CharacterMotionSlots = Readonly<Record<MotionSlotName, MotionSlot>>;
export function selfMotionSlots(base: string): CharacterMotionSlots {
  const standing = `${base}assets/self-agent/standing-v2.png`;
  const fallback = {staticSource: standing, authoredAction: false, description: '站姿平移原型；尚无逐帧走路、入座或工作动作'};
  return {
    idle: {staticSource: standing, animatedSource: `${base}assets/self-agent/idle-preview-v2.gif`, authoredAction: true, description: '已确认待机参考，非最终像素锁定精灵'},
    active: fallback, stopping: fallback, unknown: fallback, arrival: fallback, move: fallback, departure: fallback,
  };
}
