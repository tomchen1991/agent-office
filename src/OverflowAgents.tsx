import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DemoCharacter } from './demoAssets';
import type { OfficePersona } from './residentVisuals';
import { demoAssetUrl } from './assetUrl';
import { startMotionClock } from './motionClock';
import { advanceOverflow, reconcileOverflow, overflowPlacement } from './overflowMotion';
import type { OverflowActor, OverflowTarget } from './overflowMotion';
import { OFFICE_WORLD } from './wholeOfficeGeometry';
import { liveStatusLabels } from './liveOfficeMotion';

export interface OverflowPresentation extends OverflowTarget { name: string; persona: OfficePersona }
/** No furniture, synthetic task or seated pose is assigned to a standing overflow actor. */
export function OverflowAgents({ targets, characters, paused, reducedMotion, sourceKey, assetReady, onSelect }: {
  targets: readonly OverflowPresentation[]; characters: readonly DemoCharacter[];
  paused: boolean; reducedMotion: boolean; sourceKey: unknown;
  assetReady: (src: string) => boolean; onSelect: (id: string) => void;
}) {
  const signature = JSON.stringify(targets.map(({ id, identityKey, status }) => ({ id, identityKey, status })));
  const [stored, setStored] = useState<{ key: unknown; actors: OverflowActor[] }>({ key: sourceKey, actors: [] });
  const actors = reconcileOverflow(stored.key === sourceKey ? stored.actors : [], targets);
  useEffect(() => {
    setStored(old => ({ key: sourceKey, actors: reconcileOverflow(old.key === sourceKey ? old.actors : [], JSON.parse(signature)) }));
    if (paused || reducedMotion || !targets.some(target => target.status === 'idle' || target.status === 'working')) return;
    return startMotionClock({ request: fn => window.requestAnimationFrame(fn), cancel: id => window.cancelAnimationFrame(id) }, delta => {
      setStored(old => old.key !== sourceKey ? old : { ...old, actors: advanceOverflow(old.actors, delta) });
    });
  }, [signature, sourceKey, paused, reducedMotion]);
  return <>{actors.map(actor => {
    const target = targets.find(item => item.id === actor.id)!;
    const character = characters.find(item => item.id === target.persona);
    const tablet = actor.status === 'working' && character?.tablet && assetReady(character.tablet.src) ? character.tablet : undefined;
    const atlas = tablet ?? character?.locomotion;
    const loaded = atlas && assetReady(atlas.src);
    const moving = actor.status === 'idle' && !reducedMotion;
    const frame = reducedMotion ? 0 : tablet ? Math.floor(actor.elapsedMs / 300) % (tablet.columns * tablet.rows) : moving ? Math.floor(actor.elapsedMs / 180) % 4 : 0;
    const point = overflowPlacement(actor);
    const style = { left: `${point.x / OFFICE_WORLD.width * 100}%`, top: `${point.y / OFFICE_WORLD.height * 100}%`,
      width: `${170 / OFFICE_WORLD.width * 100}%`, zIndex: point.y,
      '--contact-x': `${(point.mirrored ? 1 - (atlas?.anchor.x ?? .5) : (atlas?.anchor.x ?? .5)) * 100}%`,
      '--contact-y': `${(atlas?.anchor.y ?? 1) * 100}%`, '--sprite-ratio': `${atlas?.cellWidth ?? 512} / ${atlas?.cellHeight ?? 512}` } as CSSProperties;
    return <div key={actor.identityKey} className="wo-actor wo-overflow-actor" style={style} role="button" tabIndex={0}
      data-overflow-agent={actor.id} data-overflow-status={actor.status} data-overflow-art={tablet ? 'tablet' : loaded ? 'standing' : 'placeholder'}
      aria-label={`${target.name}，无固定工位，${liveStatusLabels[actor.status]}，查看详情`} aria-haspopup="dialog"
      onClick={() => onSelect(actor.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(actor.id); } }}>
      {loaded ? <div className="wo-sprite" style={{ backgroundImage: `url("${demoAssetUrl(atlas.src)}")`, backgroundSize: `${atlas.columns * 100}% ${atlas.rows * 100}%`,
        backgroundPosition: `${atlas.columns === 1 ? 0 : frame % atlas.columns / (atlas.columns - 1) * 100}% ${atlas.rows === 1 ? 0 : Math.floor(frame / atlas.columns) / (atlas.rows - 1) * 100}%`, transform: point.mirrored ? 'scaleX(-1)' : undefined }} />
        : <div className="wo-unknown-persona" aria-label="角色素材未就绪"><b>?</b></div>}
    </div>;
  })}</>;
}
