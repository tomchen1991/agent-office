import { useEffect, useRef, useState } from 'react';
import { advanceLiveOffice, liveOfficeNeedsClock, reconcileLiveOffice } from './liveOfficeMotion';
import type { LiveOfficeMotionState, LiveOfficeTarget } from './liveOfficeMotion';
import { startMotionClock } from './motionClock';

export function useLiveOfficeMotion(targets: readonly LiveOfficeTarget[], options: {
  sourceKey: unknown; reducedMotion: boolean; paused: boolean; assetsReady: boolean;
}): LiveOfficeMotionState {
  const [stored, setStored] = useState<{ key: unknown; actors: LiveOfficeMotionState }>({ key: options.sourceKey, actors: [] });
  const generation = useRef(0);
  const targetKey = JSON.stringify(targets);
  // Project new data synchronously, so an old work frame cannot leak through a source switch.
  const actors = reconcileLiveOffice(stored.key === options.sourceKey ? stored.actors : stored.actors.filter(actor => actor.personalRole === 'self' && actor.phase === 'personal').map(actor => ({ ...actor, visualOnly: true, frozen: true })), targets, options.reducedMotion);
  useEffect(() => {
    setStored(previous => ({ key: options.sourceKey, actors: reconcileLiveOffice(previous.key === options.sourceKey ? previous.actors : previous.actors.filter(actor => actor.personalRole === 'self' && actor.phase === 'personal').map(actor => ({ ...actor, visualOnly: true, frozen: true })), JSON.parse(targetKey), options.reducedMotion) }));
  }, [targetKey, options.sourceKey, options.reducedMotion]);
  const needsClock = liveOfficeNeedsClock(actors);
  useEffect(() => {
    const epoch = ++generation.current;
    if (options.reducedMotion || options.paused || !options.assetsReady || !needsClock) return;
    const stop = startMotionClock({ request: callback => window.requestAnimationFrame(callback), cancel: handle => window.cancelAnimationFrame(handle) }, delta => {
      setStored(previous => generation.current === epoch && previous.key === options.sourceKey ? { ...previous, actors: reconcileLiveOffice(advanceLiveOffice(previous.actors, delta), JSON.parse(targetKey), options.reducedMotion) } : previous);
    });
    return () => { ++generation.current; stop(); };
  }, [targetKey, options.sourceKey, options.reducedMotion, options.paused, options.assetsReady, needsClock]);
  return actors;
}
