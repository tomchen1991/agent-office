import { useEffect, useRef, useState } from 'react';
import { advanceMotion, reconcileMotion } from './motion';
import type { MotionState, MotionTarget } from './motion';
import { startMotionClock } from './motionClock';

/** Single cancellable clock. Animation pause never pauses source freshness. */
export function useOfficeMotion(targets: readonly MotionTarget[], options: {
  paused: boolean; reducedMotion: boolean; connected: boolean; sourceKey: unknown;
}): MotionState {
  const [actors, setActors] = useState<MotionState>([]);
  const source = useRef(options.sourceKey);
  const generation = useRef(0);
  // Primitive dependency: identical targets never retrigger reconciliation on RAF renders.
  const targetKey = JSON.stringify(targets);
  useEffect(() => {
    const changedSource = source.current !== options.sourceKey;
    source.current = options.sourceKey;
    setActors(previous => reconcileMotion(changedSource ? [] : previous, JSON.parse(targetKey) as MotionTarget[], {
      reducedMotion: options.reducedMotion, connected: options.connected,
    }));
  }, [targetKey, options.reducedMotion, options.connected, options.sourceKey]);
  const hasMovement = actors.some(actor => actor.phase !== 'seated');
  useEffect(() => {
    const epoch = ++generation.current;
    if (options.reducedMotion) {
      setActors(previous => advanceMotion(previous, 0, { reducedMotion: true }));
      return;
    }
    if (options.paused || !options.connected || !hasMovement) return;
    const stop = startMotionClock({
      request: callback => window.requestAnimationFrame(callback),
      cancel: handle => window.cancelAnimationFrame(handle),
    }, elapsed => {
      setActors(previous => generation.current === epoch ? advanceMotion(previous, elapsed) : previous);
    });
    return () => { ++generation.current; stop(); };
  }, [options.paused, options.reducedMotion, options.connected, options.sourceKey, hasMovement]);
  return source.current === options.sourceKey ? actors : [];
}
