import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { CharacterId, OfficeStatus } from './core';
import { demoCharacters } from './demoAssets';
import type { DemoCharacter } from './demoAssets';
import { demoFrame } from './demoTimeline';
import type { DemoStage } from './demoTimeline';
import { fixedOfficeSeats, fixedOfficeTables, MAX_SIMULATED_CHILD_SEATS, OFFICE_WORLD, officeActorDepth, officeActorPlacement, officeLocalPoint } from './wholeOfficeGeometry';
import type { OfficeLayout, OfficeSeat } from './wholeOfficeGeometry';
import './whole-office.css';

export interface OfficeSceneSeat extends Omit<OfficeSeat, 'persona'> { persona: CharacterId; isLeader?: boolean; geometryId?: string }
export interface OfficeScenePose {
  stage: DemoStage; stageElapsedMs: number; progress: number; label: string;
  sheet?: 'locomotion' | 'seated'; frame?: number;
  status?: OfficeStatus; phase?: string;
}
export interface WholeOfficeSceneProps {
  layout: OfficeLayout; seats: readonly OfficeSceneSeat[];
  poseForSeat: (seat: OfficeSceneSeat) => OfficeScenePose | null;
  characters?: readonly DemoCharacter[]; canAnimate: boolean; reducedMotion: boolean;
  childCount: number; worldStage?: string; floorLabel: string; floorStatus: string;
  working?: boolean; error?: boolean; leaderLabel?: string;
  live?: boolean; selectedId?: string; onSelect?: (id: string) => void;
  loading?: ReactNode; children?: ReactNode;
  statusForSeat?: (seat: OfficeSceneSeat) => { status: OfficeStatus; label: string };
}
const assetUrl = (src: string) => `${import.meta.env.BASE_URL}${src}`;
const position = (x: number, y: number, width?: number, height?: number, depth?: number): CSSProperties => ({
  left: `${x / OFFICE_WORLD.width * 100}%`, top: `${y / OFFICE_WORLD.height * 100}%`,
  ...(width === undefined ? {} : { width: `${width / OFFICE_WORLD.width * 100}%` }),
  ...(height === undefined ? {} : { height: `${height / OFFICE_WORLD.height * 100}%` }),
  ...(depth === undefined ? {} : { zIndex: Math.round(depth) }),
});
const furniturePosition = (seat: OfficeSeat, x: number, y: number, width: number, height: number, depth: number): CSSProperties => {
  const point = officeLocalPoint(seat, seat.mirrored ? x + width : x, y);
  return { ...position(point.x, point.y, width * seat.scale, height * seat.scale, depth), '--seat-scale': seat.scale } as CSSProperties;
};

const COMFORTABLE_ZOOM = .65;
type OfficeRegion = 'overview' | 'private' | 'public' | 'desks' | 'fit';
const regionCenters = {
  private: { x: 350, y: 650 }, public: { x: 1510, y: 430 }, desks: { x: 1510, y: 1060 },
};

/** Shared approved office presentation. The caller owns its clock and data semantics. */
export function WholeOfficeScene({ layout, seats, poseForSeat, characters = demoCharacters, canAnimate, reducedMotion,
  childCount, worldStage = 'live', floorLabel, floorStatus, working = false, error = false,
  leaderLabel = 'ChatGPT', live = false, selectedId, onSelect, loading, children, statusForSeat }: WholeOfficeSceneProps) {
  const [zoom, setZoom] = useState<number | null>(COMFORTABLE_ZOOM);
  const [navigation, setNavigation] = useState<{ region: OfficeRegion; behavior: ScrollBehavior }>({ region: 'overview', behavior: 'auto' });
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
      left = center.x / OFFICE_WORLD.width * width - port.clientWidth / 2;
      top = center.y / OFFICE_WORLD.height * height - port.clientHeight / 2;
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
    const { stage = 'work', stageElapsedMs = 0, progress = 0 } = current ?? {};
    const working = current?.status ? current.status === 'working' && (!live || current.phase === 'seated') : stage === 'work' && current !== null;
    const error = !seat.empty && current !== null && !live && stage === 'error';
    const workBeat = reducedMotion ? 0 : Math.floor(stageElapsedMs / 260);
    const placement = officeActorPlacement({ ...seat, id: seat.geometryId ?? seat.id, persona: calibration.id }, calibration, stage, stageElapsedMs, progress, reducedMotion);
    const defaultFrame = demoFrame({ stage, stageElapsedMs: placement.motionElapsedMs, progress }, reducedMotion);
    const sheet = current?.sheet ?? defaultFrame.sheet;
    const frame = current?.frame ?? defaultFrame.frame;
    const atlas = calibration[sheet];
    const shared = Boolean(seat.sharedTable);
    const surfaceDepth = shared ? fixedOfficeTables.find(table => table.id === seat.tableId)!.depth : seat.y + (calibration.locomotion.anchor.y - calibration.seated.anchor.y) * placement.width + 4;
    const facingClass = seat.mirrored ? 'wo-seat-mirrored' : '';
    const spriteStyle = {
      ...position(placement.x, placement.y, placement.width, undefined, officeActorDepth(placement, calibration)),
      '--contact-x': `${placement.contactX * 100}%`, '--contact-y': `${placement.contactY * 100}%`,
      '--sprite-ratio': `${atlas.cellWidth} / ${atlas.cellHeight}`, opacity: placement.opacity,
    } as CSSProperties;
    const frameStyle: CSSProperties = {
      backgroundImage: `url("${assetUrl(atlas.src)}")`,
      backgroundSize: `${atlas.columns * 100}% ${atlas.rows * 100}%`,
      backgroundPosition: `${frame % atlas.columns / (atlas.columns - 1) * 100}% ${Math.floor(frame / atlas.columns) / (atlas.rows - 1) * 100}%`,
      transform: placement.mirrored ? 'scaleX(-1)' : undefined,
    };
    return <Fragment key={seat.id}>
      <div data-office-seat={seat.geometryId ?? seat.id} data-office-empty={Boolean(seat.empty)} className={`wo-chair wo-${seat.kind} ${facingClass}`} style={furniturePosition({ ...seat, persona: calibration.id }, 625, 262.2, 110, 142.5, seat.y - 5)} aria-hidden="true"><span className="wo-chair-back" /><span className="wo-chair-seat" /><span className="wo-chair-leg" /></div>
      {!shared && <div className={`wo-desk-back wo-${seat.persona}`} style={furniturePosition({ ...seat, persona: calibration.id }, 600, 376.2, 310, 57, seat.y - 10)} aria-hidden="true" />}
      <div className={`wo-monitor ${facingClass} ${working ? 'wo-screen-work' : ''} ${error ? 'wo-screen-error' : ''}`} style={furniturePosition({ ...seat, persona: calibration.id }, 770, 267.9, shared ? 105 : 120, shared ? 110 : 119.7, shared ? surfaceDepth + 1 : surfaceDepth - 1)} aria-hidden="true"><div className="wo-screen"><strong>{seat.empty ? '○' : error ? '!' : working ? '>_' : !live && stage === 'slack' ? '☕' : indication?.status === 'stopping' ? 'Ⅱ' : indication?.status === 'unknown' ? '?' : '···'}</strong>{[0, 1, 2].map(index => <i key={index} style={{ width: `${working ? 28 + (workBeat * 13 + index * 19) % 60 : 50 - index * 10}%` }} />)}{working && !live && <b style={{ width: `${progress * 100}%` }} />}</div><span className="wo-monitor-neck" /></div>
      {!seat.empty && canAnimate && current && <div className={`wo-actor wo-${seat.kind}`} style={spriteStyle} data-office-actor={seat.id} data-office-persona={seat.persona} data-office-status={current.status} data-office-phase={current.phase ?? stage} data-office-seat-kind={seat.kind} data-office-facing={placement.mirrored ? 'left' : 'right'} data-office-contact-x={placement.contactX} data-office-contact-y={placement.contactY} role="img" aria-label={`${seat.label}，${seat.role}，${current.label}`}>{character ? <div className="wo-sprite" style={frameStyle} data-office-sheet={sheet} data-office-frame={frame} /> : <div className="wo-unknown-persona"><b>?</b><span>身份未映射</span></div>}</div>}
      {!shared && <div className={`wo-desk-front wo-${seat.kind} wo-${seat.persona}`} style={furniturePosition({ ...seat, persona: calibration.id }, 590, 376.2, 330, 119.7, surfaceDepth)} data-office-leader={seat.isLeader || undefined} data-office-desk={seat.geometryId ?? seat.id} data-office-empty={Boolean(seat.empty)} data-office-seat-kind={seat.kind}>
        <span className="wo-desk-top" /><span className="wo-desk-leg wo-left" /><span className="wo-desk-leg wo-right" />
        <span className="wo-nameplate"><strong>{seat.label}</strong><small>{seat.role}</small></span>
      </div>}
      <div className={`wo-keyboard ${facingClass}`} style={furniturePosition({ ...seat, persona: calibration.id }, 630, 358, 110, 15, surfaceDepth + 1)} data-office-workbeat={working ? workBeat : undefined} aria-hidden="true">{Array.from({ length: 8 }, (_, key) => <i key={key} className={working && !reducedMotion && key === workBeat % 8 ? 'wo-key-pressed' : ''} />)}</div>
      {shared && <div className={`wo-shared-name wo-${seat.persona}`} style={position(seat.x - 37, seat.y + 27, 120, 42, surfaceDepth + 3)}><strong>{seat.label}</strong><small>{seat.role}</small></div>}
      {live && !seat.empty && <button className={`wo-seat-select ${selectedId === seat.id ? 'wo-seat-selected' : ''}`} style={position(seat.x - 55 * seat.scale, seat.y + 36 * seat.scale, 180 * seat.scale, 78 * seat.scale, 950)} onClick={() => onSelect?.(seat.id)} aria-pressed={selectedId === seat.id} aria-label={`${seat.label}，${indication?.label ?? '未收到数据'}，查看详情`}><span className={`wo-live-status wo-status-${indication?.status ?? 'unknown'}`}>{indication?.label ?? '未收到数据'}</span></button>}
      {error && seat.kind !== 'simulated-child' && <div className="wo-error-bubble" style={position(seat.x - 62, seat.y - 158, 150, undefined, 900)}>! 演示任务异常</div>}
    </Fragment>;
  };

  return <div className="wo-scene-card">
      <div className="wo-view-controls"><span>默认近景 · 可滚动全景 · 23 席完整保留<small>1 间主办公室 · 4 张协作桌 · 10 个独立工位</small></span><div><button onClick={() => setZoom(value => { const current = value ?? visibleScale(); return Math.min(current, Math.max(.025, current * .8)); })} aria-label="缩小办公室">−</button><button onClick={() => setZoom(value => Math.min(1.5, (value ?? visibleScale()) / .8))} aria-label="放大办公室">＋</button><button onClick={() => navigate('overview')} aria-pressed={zoom === COMFORTABLE_ZOOM}>舒适近景</button><button onClick={() => navigate('fit')} aria-pressed={zoom === null}>适应全景</button><button onClick={() => setZoom(1)} aria-pressed={zoom === 1}>100%</button><button onClick={() => viewport.current?.scrollBy({ left: -320, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向左平移">←</button><button onClick={() => viewport.current?.scrollBy({ left: 320, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向右平移">→</button><button onClick={() => viewport.current?.scrollBy({ top: -260, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向上平移">↑</button><button onClick={() => viewport.current?.scrollBy({ top: 260, behavior: reducedMotion ? 'auto' : 'smooth' })} aria-label="向下平移">↓</button></div></div>
      <div className="wo-region-controls" role="group" aria-label="跳转办公区域"><span>查看区域</span><button onClick={() => navigate('private')}>主办公室</button><button onClick={() => navigate('public')}>公共协作桌</button><button onClick={() => navigate('desks')}>独立工位</button><small>滚动或使用方向按钮探索整层</small></div>
      <div ref={viewport} className="wo-viewport" tabIndex={0} role="region" aria-label="办公室可滚动全景，默认近景，完整保留 23 席，可缩放及横向纵向滚动">
        <div ref={world} className={`wo-world wo-fixed-world wo-stage-${worldStage}`} style={zoom === null ? undefined : { width: OFFICE_WORLD.width * zoom }}>
          <div className="wo-back-wall" aria-hidden="true"><span className="wo-studio-sign">✦ NIGHT SHIFT STUDIO</span><div className="wo-window wo-window-private"><i /><i /><i /><i /></div><div className="wo-window wo-window-team"><i /><i /><i /><i /></div><span className="wo-wall-clock">03 : 26</span></div>
          <div className="wo-floor" aria-hidden="true" />
          <div className="wo-private-floor" aria-hidden="true" />
          <div className="wo-team-rug" aria-hidden="true" />
          <div className="wo-private-border wo-private-top" aria-hidden="true" /><div className="wo-private-border wo-private-left" aria-hidden="true" /><div className="wo-private-border wo-private-bottom" aria-hidden="true" />
          <div className="wo-glass-wall" aria-hidden="true"><i /><i /><i /></div>
          <div className="wo-private-door" aria-label="独立办公室的敞开门口"><span>OPEN</span></div>
          <div className="wo-room-title wo-private-title"><span>01 / PRIVATE OFFICE</span><h2>自研 Agent 独立办公室</h2><small>专属空间，不等于团队任务负责人</small></div>
          <div className="wo-room-title wo-team-title"><span>02 / PUBLIC STUDIO</span><h2>公共办公区</h2><small>3 张协作桌 · 10 个独立工位 · 19 席</small></div>
          <div className="wo-owner-rug" aria-hidden="true" />
          <svg className="wo-scythe-rack" viewBox="0 0 90 180" aria-label="工位旁停放的星月镰刀" role="img"><path d="M42 35 L52 167" stroke="#5a365f" strokeWidth="9"/><path d="M42 35 L52 167" stroke="#cca0e2" strokeWidth="4"/><path d="M12 39 Q42 -3 82 30 Q52 16 28 51Z" fill="#d8b5ed" stroke="#63417c" strokeWidth="3"/><path d="M44 24 L55 35 L46 47 L35 35Z" fill="#9c57cc" stroke="#f0d6ff" strokeWidth="2"/><path d="M27 47 L22 66 L34 60Z" fill="#aa78c8"/><path d="M35 164 H70 L75 174 H30Z" fill="#684575"/><circle cx="59" cy="53" r="5" fill="#ead7a0"/></svg>
          <div className="wo-child-label"><strong>主办公室协作桌 · 3 席</strong><span>{live ? '显式配置的子 Agent · 最多展示 3 席' : '模拟子 Actor · 复用自研外观，不是新增角色'}</span></div>
          {childCount > MAX_SIMULATED_CHILD_SEATS && <div className="wo-child-overflow" aria-label={`还有 ${childCount - MAX_SIMULATED_CHILD_SEATS} 个${live ? '子 Agent' : '模拟子 Actor'}，最多展示 ${MAX_SIMULATED_CHILD_SEATS} 个席位`}><b>+{childCount - MAX_SIMULATED_CHILD_SEATS}</b><span>另有{live ? '子 Agent' : '模拟子 Actor'}<br/>最多展开 3 席</span></div>}

          {fixedOfficeTables.map(table => {
            const tableOccupants = furnitureSeats.filter(seat => seat.tableId === table.id && !seat.empty);
            const poses = tableOccupants.map(poseForSeat).filter(pose => pose !== null);
            const tableWorking = poses.some(pose => pose.status ? pose.status === 'working' : pose.stage === 'work');
            const tableError = !live && poses.some(pose => pose.stage === 'error');
            return             <div className="wo-shared-table" key={table.id} style={position(table.x, table.y, table.width, table.height, table.depth)} data-office-shared-table={table.id} aria-label={`${table.private ? "主办公室" : "公共区域"}三席连续协作桌`}>
              <svg className="wo-shared-furniture" viewBox="0 0 635 268" aria-hidden="true">
                <ellipse className="wo-shared-shadow" cx="317.5" cy="236" rx="292" ry="24" />
                <path className="wo-shared-support" d="M111 178 H139 V250 H100 V239 H111 Z M496 178 H524 V239 H535 V250 H496 Z" />
                <path className="wo-shared-brace" d="M136 220 H499 V233 H136 Z" />
                <path className="wo-shared-apron" d="M0 111 H635 V166 Q635 208 595 208 H40 Q0 208 0 166 Z" />
                <path className="wo-shared-top" d="M0 100 Q0 84 18 84 H92 Q104 84 116 70 L166 17 Q182 0 200 0 H405 Q423 0 439 17 L489 70 Q501 84 513 84 H617 Q635 84 635 100 V150 Q635 192 595 192 H40 Q0 192 0 150 Z" />
                <path className="wo-shared-front-rim" d="M1 150 Q1 192 40 192 H595 Q634 192 634 150" />
              </svg>
              <div className={`wo-shared-project ${tableError ? 'wo-project-error' : ''}`} data-office-shared-project="true"><span>{table.private ? '办公室协作' : `协作桌 ${table.id.slice(-1)}`}</span><div><i /><i /><i /></div><b>{tableError ? '!' : tableWorking ? '↗' : '···'}</b></div>
              <span className="wo-shared-notes" aria-hidden="true"><i /><i /><i /></span>
            </div>;
          })}
          {furnitureSeats.map(renderSeat)}
          <div className="wo-plant wo-plant-one" aria-hidden="true"><span>✦</span><i /></div><div className="wo-plant wo-plant-two" aria-hidden="true"><span>✦</span><i /></div>
          <div className="wo-door-mat" aria-hidden="true">SHARED ENTRANCE<span>↑</span></div>
          <div className="wo-floor-caption"><i />{floorLabel}<span>{floorStatus}</span></div>
          <div className="wo-coffee-corner" aria-hidden="true"><span>☕</span><b>TAKE A BREATH</b><small>工作，也记得休息。</small></div>
          {loading}

        </div>
      </div>
    {children}
  </div>;
}
