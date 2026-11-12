import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { OfficeStatus } from './core';
import type { OfficePersona } from './residentVisuals';
import { demoCharacters } from './demoAssets';
import type { DemoAtlas, DemoCharacter } from './demoAssets';
import { demoFrame } from './demoTimeline';
import type { DemoStage } from './demoTimeline';
import { fixedOfficeSeats, fixedOfficeTables, officeRegionCenters, OFFICE_WORLD, OFFICE_ROOMS, OFFICE_ACTOR_RATIO, OFFICE_DESK, officeActorDepth, officeActorPlacement, officeLocalPoint } from './wholeOfficeGeometry';
import type { OfficeLayout, OfficeSeat } from './wholeOfficeGeometry';
import './whole-office.css';
import './monitor-content.css';
import './resident-office.css';
import { ResidentDesk, residentDeskLabels } from './ResidentDesk';
import { DevopsMonitor } from './DevopsMonitor';
import { personalPlacement, actorHasScythe, scytheOwnership } from './personalIdle';
import type { PersonalIdle } from './personalIdle';

export interface OfficeSceneSeat extends Omit<OfficeSeat, 'persona'> { persona: OfficePersona; isLeader?: boolean; geometryId?: string }
export interface OfficeScenePose {
  stage: DemoStage; stageElapsedMs: number; progress: number; label: string;
  sheet?: 'locomotion' | 'seated' | 'extra' | 'pickup' | 'sleep' | 'seatedBreak'; frame?: number; personal?: PersonalIdle;
  status?: OfficeStatus; phase?: string;
}
export interface WholeOfficeSceneProps {
  layout: OfficeLayout; seats: readonly OfficeSceneSeat[];
  poseForSeat: (seat: OfficeSceneSeat) => OfficeScenePose | null;
  characters?: readonly DemoCharacter[]; canAnimate: boolean; reducedMotion: boolean;
  assetReady?: (src: string) => boolean;
  childCount: number; worldStage?: string; floorLabel: string; floorStatus: string;
  working?: boolean; error?: boolean; leaderLabel?: string;
  live?: boolean; selectedId?: string; onSelect?: (id: string) => void;
  loading?: ReactNode; children?: ReactNode; worldChildren?: ReactNode;
  statusForSeat?: (seat: OfficeSceneSeat) => { status: OfficeStatus; label: string };
  sourceLabelForSeat?: (seat: OfficeSceneSeat) => string | null;
  collaborationLabelForSeats?: (seats: readonly OfficeSceneSeat[]) => string | null;
  /** A short display-only cue for a provider/model change on an already-seated instance. */
  modelSwitchForSeat?: (seat: OfficeSceneSeat) => { key: string; fromPersona: OfficePersona; toCharacter: OfficePersona } | null;
  screenForSeat?: (seat: OfficeSceneSeat) => { task: string | null; repository: string | null; stale: boolean } | null;
}
import { demoAssetUrl as assetUrl } from './assetUrl';
const position = (x: number, y: number, width?: number, height?: number, depth?: number, anchorY?: number): CSSProperties => ({
  left: `${x / OFFICE_WORLD.width * 100}%`,
  top: anchorY === undefined ? `${y / OFFICE_WORLD.height * 100}%` : `calc(${anchorY / OFFICE_WORLD.height * 100}% + ${(y - anchorY) / OFFICE_WORLD.width * 100}cqw)`,
  ...(width === undefined ? {} : { width: `${width / OFFICE_WORLD.width * 100}%` }),
  ...(height === undefined ? {} : { height: anchorY === undefined ? `${height / OFFICE_WORLD.height * 100}%` : `${height / OFFICE_WORLD.width * 100}cqw` }),
  ...(depth === undefined ? {} : { zIndex: Math.round(depth) }),
});
// Stretch only spacing between desk groups, never the furniture/actor within each group.
const seatAnchorY = (seat: OfficeSeat) => fixedOfficeTables.find(table => table.id === seat.tableId)?.y ?? seat.y;
const furniturePosition = (seat: OfficeSeat, x: number, y: number, width: number, height: number, depth: number): CSSProperties => {
  const point = officeLocalPoint(seat, seat.mirrored ? x + width : x, y);
  return { ...position(point.x, point.y, width * seat.scale, height * seat.scale, depth, seatAnchorY(seat)), '--seat-scale': seat.scale } as CSSProperties;
};

const modelSwitchAccent: Record<OfficePersona, string> = {
  self: '#d9b8ff', deepseek: '#8fd3ff', chatgpt: '#8ff0c3', grok: '#ffd28f', github: '#aebdff', devops: '#8cd8e8', hotspot: '#f2bb77', unknown: '#c9ced8',
};

const COMFORTABLE_ZOOM = .65;
type OfficeRegion = 'overview' | 'private' | 'public' | 'desks' | 'devops' | 'fit';
const regionCenters = officeRegionCenters;

/** Shared approved office presentation. The caller owns its clock and data semantics. */
export function WholeOfficeScene({ layout, seats, poseForSeat, characters = demoCharacters, canAnimate, reducedMotion, assetReady,
  childCount, worldStage = 'live', floorLabel, floorStatus, live = false, onSelect, loading, children, worldChildren, statusForSeat, screenForSeat, sourceLabelForSeat, collaborationLabelForSeats, modelSwitchForSeat }: WholeOfficeSceneProps) {
  const [zoom, setZoom] = useState<number | null>(null);
  const [navigation, setNavigation] = useState<{ region: OfficeRegion; behavior: ScrollBehavior }>({ region: 'fit', behavior: 'auto' });
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const visibleScale = () => (world.current?.getBoundingClientRect().width || world.current?.clientWidth || 1200) / OFFICE_WORLD.width;
  // A fresh request also handles repeated clicks at the same zoom. Measure only
  // after React has committed the requested width, without remounting the scene.
  useLayoutEffect(() => {
    const port = viewport.current, floor = world.current;
    if (!port || !floor) return;
    const bounds = floor.getBoundingClientRect();
    const width = bounds.width || floor.clientWidth;
    if (!width || !port.clientWidth || !port.clientHeight) return;
    const height = bounds.height || width * OFFICE_WORLD.height / OFFICE_WORLD.width;
    const maxLeft = Math.max(0, width - port.clientWidth);
    const maxTop = Math.max(0, height - port.clientHeight);
    let left = 0, top = navigation.region === 'overview' ? 100 : 0;
    if (navigation.region !== 'overview' && navigation.region !== 'fit') {
      const center = regionCenters[navigation.region];
      const portBounds = port.getBoundingClientRect();
      left = (bounds.left ?? 0) - (portBounds.left ?? 0) + port.scrollLeft + center.x / OFFICE_WORLD.width * width - port.clientWidth / 2;
      top = (bounds.top ?? 0) - (portBounds.top ?? 0) + port.scrollTop + center.y / OFFICE_WORLD.height * height - port.clientHeight / 2;
    }
    port.scrollTo({ left: Math.max(0, Math.min(maxLeft, left)), top: Math.max(0, Math.min(maxTop, top)),
      behavior: navigation.behavior });
  }, [navigation]);
  const navigate = (region: OfficeRegion) => {
    setZoom(value => region === 'fit' ? null : region === 'overview' ? COMFORTABLE_ZOOM : Math.max(COMFORTABLE_ZOOM, value ?? visibleScale()));
    setNavigation({ region, behavior: region === 'fit' || reducedMotion ? 'auto' : 'smooth' });
  };
  const furnitureSeats: OfficeSceneSeat[] = fixedOfficeSeats().map(template => {
    const occupant = seats.find(seat => (seat.geometryId ?? seat.id) === template.id);
    return occupant ? { ...occupant, x: template.x, y: template.y, scale: template.scale, sharedTable: template.sharedTable, tableId: template.tableId, mirrored: template.mirrored } : template;
  });
  const renderSeat = (seat: OfficeSceneSeat) => {
    const character = characters.find(item => item.id === seat.persona);
    // Unknown identities use geometry calibration only, never another persona's artwork.
    const calibration = character ?? demoCharacters[0];
    const current = seat.empty ? null : poseForSeat(seat);
    const indication = seat.empty ? null : statusForSeat?.(seat) ?? current;
    const screen = seat.empty ? null : screenForSeat?.(seat);
    const sourceLabel = seat.empty ? null : sourceLabelForSeat?.(seat);
    const { stage = 'work', stageElapsedMs = 0, progress = 0 } = current ?? {};
    const working = current?.status ? current.status === 'working' && (!current.phase || current.phase === 'seated') : stage === 'work' && current !== null;
    const error = !seat.empty && current !== null && !live && stage === 'error';
    const workBeat = reducedMotion ? 0 : Math.floor(stageElapsedMs / 260);
    const personal = current?.personal;
    const placement = personal && ['out', 'pickup', 'scythe', 'putdown', 'back'].includes(personal.phase) ? personalPlacement({ ...seat, persona: calibration.id }, calibration, personal) : officeActorPlacement({ ...seat, id: seat.geometryId ?? seat.id, persona: calibration.id }, calibration, stage, stageElapsedMs, progress, personal ? false : reducedMotion);
    const defaultFrame = demoFrame({ stage, stageElapsedMs: placement.motionElapsedMs, progress }, reducedMotion);
    const sheet = current?.sheet ?? defaultFrame.sheet;
    const frame = current?.frame ?? defaultFrame.frame;
    const atlas = calibration[sheet] ?? calibration.seated;
    const modelSwitch = seat.empty || reducedMotion ? null : modelSwitchForSeat?.(seat) ?? null;
    const swapCharacter = modelSwitch ? characters.find(item => item.id === modelSwitch.fromPersona) : undefined;
    const swapSheet = swapCharacter && swapCharacter[sheet] ? sheet : 'seated' as const;
    const swapAtlas = swapCharacter ? swapCharacter[swapSheet] ?? swapCharacter.seated : undefined;
    const swapFrame = swapAtlas ? (swapSheet === sheet ? Math.min(frame, swapAtlas.columns * swapAtlas.rows - 1) : swapSheet === 'seated' ? 6 : 0) : 0;
    const frameStyleFor = (source: DemoAtlas, sourceFrame: number): CSSProperties => ({
      backgroundImage: `url("${assetUrl(source.src)}")`,
      backgroundSize: `${source.columns * 100}% ${source.rows * 100}%`,
      backgroundPosition: `${(source.columns === 1 ? 0 : sourceFrame % source.columns / (source.columns - 1) * 100)}% ${(source.rows === 1 ? 0 : Math.floor(sourceFrame / source.columns) / (source.rows - 1) * 100)}%`,
      transform: placement.mirrored ? 'scaleX(-1)' : undefined,
    });
    const shared = Boolean(seat.sharedTable);
    const surfaceDepth = shared ? fixedOfficeTables.find(table => table.id === seat.tableId)!.depth : seat.y + (calibration.locomotion.anchor.y - calibration.seated.anchor.y) * placement.width + 4;
    const facingClass = seat.mirrored ? 'wo-seat-mirrored' : '';
    const spriteStyle = {
      ...position(placement.x, placement.y, placement.width, undefined, officeActorDepth(placement, calibration), seatAnchorY(seat)),
      '--contact-x': `${placement.contactX * 100}%`, '--contact-y': `${placement.contactY * 100}%`,
      '--sprite-ratio': `${atlas.cellWidth} / ${atlas.cellHeight}`, opacity: placement.opacity,
    } as CSSProperties;
    const frameStyle = frameStyleFor(atlas, frame);
    return <Fragment key={seat.id}>
      <div data-office-seat={seat.geometryId ?? seat.id} data-office-empty={Boolean(seat.empty)} className={`wo-chair wo-${seat.kind} ${facingClass}`} style={furniturePosition({ ...seat, scale: seat.scale * OFFICE_ACTOR_RATIO, persona: calibration.id }, 625, 262.2, 110, 142.5, seat.y - 5)} aria-hidden="true"><span className="wo-chair-back" /><span className="wo-chair-seat" /><span className="wo-chair-leg" /></div>
      {!shared && <div className={`wo-desk-back wo-${seat.persona}`} style={furniturePosition({ ...seat, persona: calibration.id }, OFFICE_DESK.backX, 376.2, OFFICE_DESK.backWidth, 57, seat.y - 10)} aria-hidden="true" />}
      <div className={`wo-monitor ${facingClass} ${working ? 'wo-screen-work' : ''} ${error ? 'wo-screen-error' : ''}`} style={furniturePosition({ ...seat, persona: calibration.id }, 770, 267.9, shared ? 105 : 120, shared ? 110 : 119.7, shared ? surfaceDepth + 1 : surfaceDepth - 1)} aria-hidden={screen ? undefined : true} title={screen ? `${screen.stale ? '最后观察（状态未知）\n' : ''}${[screen.task, screen.repository].filter(Boolean).join('\n')}` : undefined} onClick={screen ? () => onSelect?.(seat.id) : undefined}><div className={`wo-screen ${screen ? 'wo-screen-content' : ''}`}>{screen ? <>{screen.stale && <span className="wo-screen-caption">最后观察</span>}{screen.task && <span className="wo-screen-task">{screen.task}</span>}{screen.repository && <span className="wo-screen-repository">{screen.repository}</span>}</> : <><strong>{seat.empty || (live && indication?.status === 'offline') ? '○' : error ? '!' : working ? '>_' : !live && stage === 'slack' ? '☕' : indication?.status === 'stopping' ? 'Ⅱ' : indication?.status === 'unknown' ? '?' : '···'}</strong>{[0, 1, 2].map(index => <i key={index} style={{ width: `${working ? 28 + (workBeat * 13 + index * 19) % 60 : 50 - index * 10}%` }} />)}{working && !live && <b style={{ width: `${progress * 100}%` }} />}</>}</div><span className="wo-monitor-neck" /></div>
      {!seat.empty && (canAnimate || (seat.kind === 'owner' && personal)) && (!assetReady || !character || assetReady(atlas.src)) && current && <div className={`wo-actor wo-${seat.kind}`} style={spriteStyle} data-office-actor={seat.id} data-office-persona={seat.persona} data-office-status={current.status} data-office-phase={current.phase ?? stage} data-office-personal-phase={current.personal?.phase} data-scythe-owner={seat.kind === 'owner' && seat.persona === 'self' && actorHasScythe(personal) ? 'actor' : undefined} data-scythe-state={seat.kind === 'owner' ? scytheOwnership(personal) : undefined} data-office-seat-kind={seat.kind} data-office-facing={placement.mirrored ? 'left' : 'right'} data-office-contact-x={placement.contactX} data-office-contact-y={placement.contactY} role={live ? 'button' : 'img'} tabIndex={live ? 0 : undefined} onClick={live ? () => onSelect?.(seat.id) : undefined} onKeyDown={live ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(seat.id); } } : undefined} aria-haspopup={live ? 'dialog' : undefined} aria-label={`${seat.label}，${seat.role}，${current.label}${live ? '，查看详情' : ''}`}>{modelSwitch ? <div key={modelSwitch.key} className="wo-sprite-stack" data-office-model-switch="true" data-office-model-from={modelSwitch.fromPersona} data-office-model-to={modelSwitch.toCharacter}><div className="wo-model-layer wo-model-layer-in">{character ? <div className="wo-sprite" style={frameStyle} data-office-sheet={sheet} data-office-frame={frame} data-office-sprite="current" /> : <div className="wo-unknown-persona" aria-label="身份未映射"><b aria-hidden="true">?</b></div>}</div>{swapAtlas && modelSwitch.fromPersona !== seat.persona && <div className="wo-model-layer wo-model-layer-out"><div className="wo-sprite" style={frameStyleFor(swapAtlas, swapFrame)} data-office-sheet={swapSheet} data-office-frame={swapFrame} data-office-sprite="previous" /></div>}<div className="wo-model-swap" style={{ '--model-swap-accent': modelSwitchAccent[seat.persona] } as CSSProperties} aria-hidden="true"><span className="wo-model-swap-ring" /><span className="wo-model-swap-scan" /><span className="wo-model-swap-particles">{Array.from({ length: 7 }, (_, index) => <i key={index} style={{ '--i': index } as CSSProperties} />)}</span></div></div> : character ? <div className="wo-sprite" style={frameStyle} data-office-sheet={sheet} data-office-frame={frame} /> : <div className="wo-unknown-persona" aria-label="身份未映射"><b aria-hidden="true">?</b></div>}</div>}
      {!shared && <div className={`wo-desk-front wo-${seat.kind} wo-${seat.persona} ${seat.residentRole ? `wo-resident-desk wo-desk-${seat.residentRole}` : ''}`} style={furniturePosition({ ...seat, persona: calibration.id }, OFFICE_DESK.frontX, 376.2, OFFICE_DESK.frontWidth, 119.7, surfaceDepth)} data-office-leader={seat.isLeader || undefined} data-office-desk={seat.geometryId ?? seat.id} data-resident-role={seat.residentRole} data-office-empty={Boolean(seat.empty)} data-office-seat-kind={seat.kind}>
        <span className="wo-desk-top" /><span className="wo-desk-leg wo-left" /><span className="wo-desk-leg wo-right" />{seat.residentRole && <span className="wo-resident-name"><b>{residentDeskLabels[seat.residentRole]}</b><i>{seat.residentRole === 'main' ? '✦' : seat.residentRole === 'auto-fix' ? '⌘' : seat.residentRole === 'devops' ? '▥' : '◎'}</i></span>}
      </div>}
      {seat.residentRole && <div className="wo-resident-accessory" style={furniturePosition({ ...seat, persona: calibration.id }, 805, 320, 90, 60, surfaceDepth + 2)}><ResidentDesk role={seat.residentRole} /></div>}
      {sourceLabel && <div className="wo-source-plaque" style={position(seat.x - 58 * seat.scale, seat.y + 43 * seat.scale, 180 * seat.scale, undefined, surfaceDepth + 2, seatAnchorY(seat))} title={sourceLabel}>{sourceLabel}</div>}
      <div className={`wo-keyboard ${facingClass}`} style={furniturePosition({ ...seat, scale: seat.scale * OFFICE_ACTOR_RATIO, persona: calibration.id }, 630, 358, 110, 15, surfaceDepth + 1)} data-office-workbeat={working ? workBeat : undefined} aria-hidden="true">{Array.from({ length: 8 }, (_, key) => <i key={key} className={working && !reducedMotion && key === workBeat % 8 ? 'wo-key-pressed' : ''} />)}</div>
      {error && seat.kind !== 'simulated-child' && <div className="wo-error-bubble" style={position(seat.x - 62, seat.y - 158, 150, undefined, 900)} role="img" aria-label="演示任务异常">!</div>}
    </Fragment>;
  };

  return <div className="wo-scene-card">
      <div className="wo-view-controls"><div><button onClick={() => setZoom(value => { const current = value ?? visibleScale(); return Math.min(current, Math.max(.025, current * .8)); })} aria-label="缩小办公室">−</button><button onClick={() => setZoom(value => Math.min(1.5, (value ?? visibleScale()) / .8))} aria-label="放大办公室">＋</button><button onClick={() => navigate('overview')} aria-pressed={zoom === COMFORTABLE_ZOOM}>舒适近景</button><button onClick={() => navigate('fit')} aria-pressed={zoom === null}>适应全景</button><button onClick={() => setZoom(1)} aria-pressed={zoom === 1}>100%</button><button onClick={() => viewport.current?.scrollBy({ left: -320, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向左平移">←</button><button onClick={() => viewport.current?.scrollBy({ left: 320, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向右平移">→</button><button onClick={() => viewport.current?.scrollBy({ top: -260, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向上平移">↑</button><button onClick={() => viewport.current?.scrollBy({ top: 260, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向下平移">↓</button></div></div>
      {<div className="wo-region-controls" role="group" aria-label="跳转办公区域"><button onClick={() => navigate('private')}>主办公室</button><button onClick={() => navigate('public')}>公共协作桌</button><button onClick={() => navigate('desks')}>独立工位</button><button onClick={() => navigate('devops')}>DevOps 办公室</button></div>}
      <div ref={viewport} className="wo-viewport" tabIndex={0} role="region" aria-label="办公室可滚动全景，默认紧凑全景，共 20 席，子 Agent 使用公共工位，可缩放及横向纵向滚动">
        <div ref={world} className={`wo-world wo-fixed-world wo-stage-${worldStage}`} role="group" aria-label={`${floorLabel}，${floorStatus}`} style={zoom === null ? undefined : { width: OFFICE_WORLD.width * zoom }}>
          <div className="wo-back-wall" aria-hidden="true" />
          <div className="wo-floor" aria-hidden="true" />
          <div className="wo-team-rug" aria-hidden="true" />
          {Object.entries(OFFICE_ROOMS).map(([id, room]) => <section key={id} className={`wo-room wo-room-${id}`} style={position(room.x, room.y, room.width, room.height, 20)} aria-label={id === 'main' ? '主 Agent 独立办公室' : 'DevOps 独立办公室，Auto-fix 与 DevOps 同室'}>
            <div className="wo-room-backdrop" aria-hidden="true" />
            <i className="wo-room-wall wo-room-wall-top" aria-hidden="true" /><i className="wo-room-wall wo-room-wall-left" aria-hidden="true" /><i className="wo-room-wall wo-room-wall-bottom" aria-hidden="true" />
            <i className="wo-room-wall wo-room-wall-right" style={{ top: 0, height: `${(room.doorTop - room.y) / room.height * 100}%` }} aria-hidden="true" />
            {room.doorBottom < room.y + room.height && <i className="wo-room-wall wo-room-wall-right" style={{ top: `${(room.doorBottom - room.y) / room.height * 100}%`, bottom: 0 }} aria-hidden="true" />}
            <div className={`wo-room-door ${id === 'main' ? 'wo-private-door' : 'wo-ops-door'}`} style={{ top: `${(room.doorTop - room.y) / room.height * 100}%`, height: `${(room.doorBottom - room.doorTop) / room.height * 100}%` }} aria-label={`${id === 'main' ? '主 Agent 独立办公室' : 'DevOps 办公室'}的敞开门洞`}><i /><i /><span /></div>
          </section>)}
          {[
            { id: 'main-left', x: 90, width: 230 }, { id: 'main-right', x: 390, width: 230 },
            { id: 'public-left', x: 920, width: 280 }, { id: 'public-center', x: 1360, width: 280 }, { id: 'public-right', x: 1820, width: 280 },
          ].map(window => <div key={window.id} className="wo-room-window" data-office-window={window.id} style={position(window.x, 135, window.width, 64, 23, 135)} aria-hidden="true"><span /><span /><i /></div>)}
          <div className="wo-owner-rug" aria-hidden="true" />
          <div className="wo-devops-wall-screen" style={position(70, 585, 600, 110, 100, 585)}><DevopsMonitor compact /></div>
          {(() => {
            const owner = furnitureSeats.find(seat => seat.kind === 'owner')!;
            const self = characters.find(character => character.id === 'self');
            if (!self?.parkedScythe) return null;
            const action = !owner.empty && owner.persona === 'self' ? poseForSeat(owner)?.personal : undefined;
            const placement = personalPlacement({ ...owner, persona: 'self' }, self, { phase: 'pickup', elapsedMs: 0 });
            const standX = placement.x + (211 / 512 - placement.contactX) * placement.width;
            return <Fragment><span className="wo-scythe-stand" data-testid="scythe-stand" aria-label="星月镰刀固定底座"
              style={position(standX - 14, placement.y - 2, 28, 8, placement.y - 1, seatAnchorY(owner))} />
              {!actorHasScythe(action) && <img className="wo-parked-scythe" src={assetUrl(self.parkedScythe.src)}
              onError={event => { event.currentTarget.style.visibility = 'hidden'; }} onLoad={event => { event.currentTarget.style.visibility = 'visible'; }}
              data-testid="parked-scythe" data-scythe-owner="stand" data-scythe-state={scytheOwnership(action)}
              alt="停放在取放点的星月镰刀" style={{ ...position(placement.x, placement.y, placement.width, undefined, placement.y + 1, seatAnchorY(owner)),
                transform: `translate(-${placement.contactX * 100}%, -${placement.contactY * 100}%)` }} />}</Fragment>;
          })()}

          {fixedOfficeTables.map(table => {
            const tableOccupants = furnitureSeats.filter(seat => seat.tableId === table.id && !seat.empty);
            const poses = tableOccupants.map(poseForSeat).filter(pose => pose !== null);
            const tableWorking = poses.some(pose => pose.status ? pose.status === 'working' : pose.stage === 'work');
            const tableError = !live && poses.some(pose => pose.stage === 'error');
            return             <div className="wo-shared-table" key={table.id} style={position(table.x, table.y, table.width, table.height, table.depth, table.y)} data-office-shared-table={table.id} aria-label={`${table.private ? "主办公室" : "公共区域"}三席连续协作桌`}>
              <svg className="wo-shared-furniture" viewBox="0 0 635 268" preserveAspectRatio="none" aria-hidden="true">
                <ellipse className="wo-shared-shadow" cx="317.5" cy="236" rx="292" ry="24" />
                <path className="wo-shared-support" d="M111 178 H139 V250 H100 V239 H111 Z M496 178 H524 V239 H535 V250 H496 Z" />
                <path className="wo-shared-brace" d="M136 220 H499 V233 H136 Z" />
                <path className="wo-shared-apron" d="M0 111 H635 V166 Q635 208 595 208 H40 Q0 208 0 166 Z" />
                <path className="wo-shared-top" d="M0 100 Q0 84 18 84 H92 Q104 84 116 70 L166 17 Q182 0 200 0 H405 Q423 0 439 17 L489 70 Q501 84 513 84 H617 Q635 84 635 100 V150 Q635 192 595 192 H40 Q0 192 0 150 Z" />
                <path className="wo-shared-front-rim" d="M1 150 Q1 192 40 192 H595 Q634 192 634 150" />
              </svg>
              <div className={`wo-shared-project ${tableError ? 'wo-project-error' : ''}`} data-office-shared-project="true"><div><i /><i /><i /></div><b>{tableError ? '!' : tableWorking ? '↗' : '···'}</b></div>
              {collaborationLabelForSeats?.(tableOccupants) && <div className="wo-live-collaboration-label">{collaborationLabelForSeats(tableOccupants)}</div>}
              <span className="wo-shared-notes" aria-hidden="true"><i /><i /><i /></span>
            </div>;
          })}
          {furnitureSeats.map(renderSeat)}
          {worldChildren}
          <div className="wo-door-mat" aria-hidden="true"><span>↑</span></div>

        </div>
      </div>
    {loading}
    {children}
  </div>;
}
