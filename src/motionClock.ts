/** Injectable animation scheduler; canceled callbacks cannot schedule or mutate again. */
export interface FrameScheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}
export function startMotionClock(scheduler: FrameScheduler, advance: (deltaMs: number) => void): () => void {
  let alive = true;
  let frame = 0;
  let previousTime: number | null = null;
  const tick = (time: number) => {
    if (!alive) return;
    const elapsed = previousTime === null ? 0 : Math.min(100, Math.max(0, time - previousTime));
    previousTime = time;
    advance(elapsed);
    if (alive) frame = scheduler.request(tick);
  };
  frame = scheduler.request(tick);
  return () => { alive = false; scheduler.cancel(frame); };
}
