import { Fragment, useEffect, useMemo, useReducer, useState } from 'react';
import type { CSSProperties } from 'react';
import { demoCharacters } from './demoAssets';
import type { DemoCharacter } from './demoAssets';
import { DEMO_STAGES, TOTAL_DEMO_MS, demoFrame, demoPosition, demoReducer, initialDemoState } from './demoTimeline';
import type { DemoStage } from './demoTimeline';
import { startMotionClock } from './motionClock';
import { MAX_SIMULATED_CHILD_SEATS, OFFICE_WORLD, SIMULATED_CHILD_COUNT, officeActorDepth, officeActorPlacement, officeLocalPoint, wholeOfficeSeats } from './wholeOfficeGeometry';
import type { OfficeLayout, OfficeSeat } from './wholeOfficeGeometry';
import './whole-office.css';

const descriptions: Record<DemoStage, string> = {
  arrival: '从共享入口进场，穿过门口，走向各自的真实席位。',
  sit: '在每把椅子前停稳，转身对齐，再坐下。',
  work: '四位角色与模拟子 Actor 同时坐在各自桌后工作。',
  slack: '一起暂停片刻，靠回椅子，喝一口饮料。',
  error: '演示任务异常：表情、屏幕与提示同步切换。',
  stand: '结束当前任务，收回双手，从椅子上起身。',
  exit: '沿各自路线回到共享入口，完整演示只播放一遍。',
};
const assetUrl = (src: string) => `${import.meta.env.BASE_URL}${src}`;
const position = (x: number, y: number, width?: number, height?: number, depth?: number): CSSProperties => ({
  left: `${x / OFFICE_WORLD.width * 100}%`, top: `${y / OFFICE_WORLD.height * 100}%`,
  ...(width === undefined ? {} : { width: `${width / OFFICE_WORLD.width * 100}%` }),
  ...(height === undefined ? {} : { height: `${height / OFFICE_WORLD.height * 100}%` }),
  ...(depth === undefined ? {} : { zIndex: Math.round(depth) }),
});
const furniturePosition = (seat: OfficeSeat, x: number, y: number, width: number, height: number, depth: number): CSSProperties => {
  const point = officeLocalPoint(seat, x, y);
  return { ...position(point.x, point.y, width * seat.scale, height * seat.scale, depth), '--seat-scale': seat.scale } as CSSProperties;
};

export function WholeOfficeDemo({ characters = demoCharacters }: { characters?: readonly DemoCharacter[] } = {}) {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const [layout, setLayout] = useState<OfficeLayout>('leader-desks');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [assets, setAssets] = useState<{ ready: boolean; failed: string[] }>({ ready: false, failed: [] });
  const seats = useMemo(() => wholeOfficeSeats(layout), [layout]);
  const available = ['self', 'deepseek', 'chatgpt', 'grok'].every(id => characters.some(character => character.id === id && character.ready));

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => { setReducedMotion(media.matches); if (media.matches) dispatch({ type: 'pause' }); };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    let alive = true;
    const loaded = new Set<string>();
    const failed = new Set<string>();
    setAssets({ ready: false, failed: [] });
    // Children explicitly reuse self's two sheets. Load all eight approved atlases before the shared clock runs.
    const sources = [...new Set(characters.flatMap(character => [character.locomotion.src, character.seated.src]))];
    const publish = () => { if (alive) setAssets({ ready: loaded.size === sources.length && failed.size === 0, failed: [...failed] }); };
    const images = sources.map(src => {
      const image = new Image();
      image.onload = () => { loaded.add(src); failed.delete(src); publish(); };
      image.onerror = () => { failed.add(src); publish(); };
      image.src = assetUrl(src);
      return image;
    });
    return () => { alive = false; for (const image of images) { image.onload = null; image.onerror = null; } };
  }, [characters, loadAttempt]);

  const canAnimate = available && assets.ready;
  useEffect(() => {
    if (!state.running || !canAnimate || reducedMotion) return;
    return startMotionClock({ request: callback => window.requestAnimationFrame(callback), cancel: handle => window.cancelAnimationFrame(handle) }, deltaMs => dispatch({ type: 'tick', deltaMs }));
  }, [state.running, canAnimate, reducedMotion]);

  const current = demoPosition(state);
  const { stage, stageElapsedMs, progress } = current;
  const { sheet } = demoFrame(current, reducedMotion);
  const activeStage = DEMO_STAGES.find(item => item.id === stage)!;
  const working = stage === 'work';
  const error = stage === 'error';
  const workBeat = reducedMotion ? 0 : Math.floor(stageElapsedMs / 260);
  const jump = (next: DemoStage) => { dispatch({ type: 'jump', stage: next }); dispatch({ type: 'pause' }); };
  const replay = () => { dispatch({ type: 'restart' }); if (reducedMotion) dispatch({ type: 'pause' }); };
  const status = !canAnimate ? '等待素材' : state.completed ? '演示结束' : reducedMotion ? '静帧查看' : state.running ? '演示中' : '已暂停';

  const renderSeat = (seat: OfficeSeat) => {
    const character = characters.find(item => item.id === seat.persona);
    if (!character) return null;
    const placement = officeActorPlacement(seat, character, stage, stageElapsedMs, progress, reducedMotion);
    const atlas = character[sheet];
    const { frame } = demoFrame({ ...current, stageElapsedMs: placement.motionElapsedMs }, reducedMotion);
    const surfaceDepth = seat.y + (character.locomotion.anchor.y - character.seated.anchor.y) * placement.width + 4;
    const shared = seat.kind === 'team' && layout === 'peer-table';
    const spriteStyle = {
      ...position(placement.x, placement.y, placement.width, undefined, officeActorDepth(placement, character)),
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
      <div className={`wo-chair wo-${seat.kind}`} style={furniturePosition(seat, 625, 262.2, 110, 142.5, seat.y - 5)} aria-hidden="true"><span className="wo-chair-back" /><span className="wo-chair-seat" /><span className="wo-chair-leg" /></div>
      {!shared && <div className={`wo-desk-back wo-${seat.persona}`} style={furniturePosition(seat, 600, 376.2, 310, 57, seat.y - 10)} aria-hidden="true" />}
      <div className={`wo-monitor ${working ? 'wo-screen-work' : ''} ${error ? 'wo-screen-error' : ''}`} style={furniturePosition(seat, 770, 267.9, 120, 119.7, surfaceDepth - 1)} aria-hidden="true"><div className="wo-screen"><strong>{error ? '!' : working ? '>_' : stage === 'slack' ? '☕' : '···'}</strong>{[0, 1, 2].map(index => <i key={index} style={{ width: `${working ? 28 + (workBeat * 13 + index * 19) % 60 : 50 - index * 10}%` }} />)}{working && <b style={{ width: `${progress * 100}%` }} />}</div><span className="wo-monitor-neck" /></div>
      {canAnimate && <div className={`wo-actor wo-${seat.kind}`} style={spriteStyle} data-office-actor={seat.id} data-office-persona={seat.persona} data-office-seat-kind={seat.kind} data-office-contact-x={placement.contactX} data-office-contact-y={placement.contactY} role="img" aria-label={`${seat.label}，${seat.role}，${activeStage.label}`}><div className="wo-sprite" style={frameStyle} data-office-sheet={sheet} data-office-frame={frame} /></div>}
      {!shared && <div className={`wo-desk-front wo-${seat.kind} wo-${seat.persona}`} style={furniturePosition(seat, 590, 376.2, 330, 119.7, surfaceDepth)} data-office-desk={seat.id} data-office-seat-kind={seat.kind}>
        <span className="wo-desk-top" /><span className="wo-desk-leg wo-left" /><span className="wo-desk-leg wo-right" />
        <span className="wo-nameplate"><strong>{seat.label}</strong><small>{seat.role}</small></span>
      </div>}
      <div className="wo-keyboard" style={furniturePosition(seat, 630, 358, 110, 15, surfaceDepth + 1)} data-office-workbeat={working ? workBeat : undefined} aria-hidden="true">{Array.from({ length: 8 }, (_, key) => <i key={key} className={working && !reducedMotion && key === workBeat % 8 ? 'wo-key-pressed' : ''} />)}</div>
      {shared && <div className={`wo-shared-name wo-${seat.persona}`} style={position(seat.x - 28, 435, 160, 42, surfaceDepth + 2)}><strong>{seat.label}</strong><small>同级协作</small></div>}
      {error && seat.kind !== 'simulated-child' && <div className="wo-error-bubble" style={position(seat.x - 62, seat.y - 158, 150, undefined, 900)}>! 演示任务异常</div>}
    </Fragment>;
  };

  return <section className="whole-office-demo" aria-labelledby="whole-office-title" data-office-stage={stage} data-office-complete={state.completed} data-office-layout={layout} data-office-assets-ready={canAnimate} data-office-reduced-motion={reducedMotion}>
    <div className="wo-heading"><div><span className="wo-kicker">AGENT OFFICE / THE WHOLE STUDIO</span><h1 id="whole-office-title">同一间办公室，一起上一天班。</h1><p>自研 Agent 有自己的房间。团队有自己的协作方式。每个席位，都有完整动作。</p></div><span className="wo-demo-tag"><i /> 26 秒完整演示 · 模拟数据</span></div>
    <div className="wo-toolbar"><div className="wo-layout-picker" role="group" aria-label="团队办公布局"><button aria-pressed={layout === 'leader-desks'} onClick={() => setLayout('leader-desks')}>主从工位</button><button aria-pressed={layout === 'peer-table'} onClick={() => setLayout('peer-table')}>平等协作桌</button></div><p>{layout === 'leader-desks' ? '本演示由 ChatGPT 负责团队任务；自研办公室权限与任务负责人互相独立。' : '三位团队角色围绕同一张协作桌工作，无固定主座。自研办公室保持独立。'}</p></div>
    <div className="wo-scene-card">
      <div className="wo-pan-hint">窄屏可左右滑动查看完整办公室</div>
      <div className="wo-viewport" tabIndex={0} role="region" aria-label="办公室全景，窄屏可左右滚动">
        <div className={`wo-world wo-stage-${stage}`}>
          <div className="wo-back-wall" aria-hidden="true"><span className="wo-studio-sign">✦ NIGHT SHIFT STUDIO</span><div className="wo-window wo-window-private"><i /><i /><i /><i /></div><div className="wo-window wo-window-team"><i /><i /><i /><i /></div><span className="wo-wall-clock">03 : 26</span></div>
          <div className="wo-floor" aria-hidden="true" />
          <div className="wo-private-floor" aria-hidden="true" />
          <div className="wo-team-rug" aria-hidden="true" />
          <div className="wo-private-border wo-private-top" aria-hidden="true" /><div className="wo-private-border wo-private-left" aria-hidden="true" /><div className="wo-private-border wo-private-bottom" aria-hidden="true" />
          <div className="wo-glass-wall" aria-hidden="true"><i /><i /><i /></div>
          <div className="wo-private-door" aria-label="独立办公室的敞开门口"><span>OPEN</span></div>
          <div className="wo-room-title wo-private-title"><span>01 / PRIVATE OFFICE</span><h2>自研 Agent 独立办公室</h2><small>专属空间，不等于团队任务负责人</small></div>
          <div className="wo-room-title wo-team-title"><span>02 / TEAM STUDIO</span><h2>{layout === 'leader-desks' ? '团队主从工位' : '平等协作办公桌'}</h2><small>{layout === 'leader-desks' ? '本次演示负责人：ChatGPT' : '共享一张桌 · 三位同级协作'}</small></div>
          <div className="wo-owner-rug" aria-hidden="true" />
          <svg className="wo-scythe-rack" viewBox="0 0 90 180" aria-label="工位旁停放的星月镰刀" role="img"><path d="M42 35 L52 167" stroke="#5a365f" strokeWidth="9"/><path d="M42 35 L52 167" stroke="#cca0e2" strokeWidth="4"/><path d="M12 39 Q42 -3 82 30 Q52 16 28 51Z" fill="#d8b5ed" stroke="#63417c" strokeWidth="3"/><path d="M44 24 L55 35 L46 47 L35 35Z" fill="#9c57cc" stroke="#f0d6ff" strokeWidth="2"/><path d="M27 47 L22 66 L34 60Z" fill="#aa78c8"/><path d="M35 164 H70 L75 174 H30Z" fill="#684575"/><circle cx="59" cy="53" r="5" fill="#ead7a0"/></svg>
          <div className="wo-child-label"><strong>子 Agent 工作区</strong><span>模拟子 Actor · 复用自研外观，不是新增角色</span></div>
          <div className="wo-child-overflow" aria-label={`还有 ${SIMULATED_CHILD_COUNT - MAX_SIMULATED_CHILD_SEATS} 个模拟子 Actor，最多展示 ${MAX_SIMULATED_CHILD_SEATS} 个席位`}><b>+{SIMULATED_CHILD_COUNT - MAX_SIMULATED_CHILD_SEATS}</b><span>另有模拟子 Actor<br/>最多展开 3 席</span></div>
          {layout === 'leader-desks' ? <svg className="wo-team-links" viewBox="0 0 1400 850" aria-hidden="true"><path d="M1045 392 L1045 421 L810 421 L810 442 M1045 421 L1140 421 L1140 442" /></svg> : <>
            <div className="wo-collaboration-note"><b>同一张桌，同一个目标。</b><span>平等协作 · 三个真实动作席位</span></div>
            <div className="wo-shared-table" style={position(649, 394.69, 750, 101.745, 431)} data-office-shared-table="true" aria-label="三位团队角色共用的一张连续协作桌"><span className="wo-desk-top" /><span className="wo-shared-edge" /><span className="wo-shared-leg wo-left" /><span className="wo-shared-leg wo-right" /></div>
          </>}
          {seats.map(renderSeat)}
          <div className="wo-plant wo-plant-one" aria-hidden="true"><span>✦</span><i /></div><div className="wo-plant wo-plant-two" aria-hidden="true"><span>✦</span><i /></div>
          <div className="wo-door-mat" aria-hidden="true">SHARED ENTRANCE<span>↑</span></div>
          <div className="wo-floor-caption"><i />{activeStage.label}<span>{status}</span></div>
          <div className="wo-coffee-corner" aria-hidden="true"><span>☕</span><b>TAKE A BREATH</b><small>工作，也记得休息。</small></div>
          {!canAnimate && <div className="wo-loading" role="status"><strong>{assets.failed.length ? '部分角色动作加载失败' : !available ? '角色动作素材尚未齐备' : '正在载入四位角色的完整动作…'}</strong><span>全部 8 张动作图集就绪后，整间办公室才会一起开始。</span>{assets.failed.length > 0 && <button onClick={() => setLoadAttempt(value => value + 1)}>重新加载素材</button>}</div>}
        </div>
      </div>
      <div className="wo-stage-summary"><div><span className="wo-step">0{DEMO_STAGES.findIndex(item => item.id === stage) + 1}</span><div><h2>{activeStage.label}</h2><p>{descriptions[stage]}</p></div></div><time>{(state.elapsedMs / 1000).toFixed(1)} / {TOTAL_DEMO_MS / 1000} s</time></div>
      <div className="wo-progress" role="progressbar" aria-label="办公室完整演示进度" aria-valuemin={0} aria-valuemax={TOTAL_DEMO_MS} aria-valuenow={state.elapsedMs}><span style={{ width: `${state.elapsedMs / TOTAL_DEMO_MS * 100}%` }} /></div>
    </div>
    <div className="wo-controls"><div><button className="wo-primary" aria-label={state.running ? '暂停办公室演示' : '播放办公室演示'} disabled={reducedMotion || (!canAnimate && !state.running)} onClick={() => dispatch({ type: state.running ? 'pause' : 'play' })}>{state.running ? '暂停演示' : state.completed ? '再看一次' : '继续播放'}</button><button aria-label="重播办公室演示" disabled={!canAnimate} onClick={replay}>从头重播</button></div><label className="wo-motion-preference"><input type="checkbox" checked={reducedMotion} onChange={event => { setReducedMotion(event.target.checked); if (event.target.checked) dispatch({ type: 'pause' }); }} />减少动态效果</label><p>{reducedMotion ? '已暂停动态播放，可选择阶段查看静帧。' : '同一条时间线 · 切换布局不重播 · 选择阶段会暂停'}</p></div>
    <nav className="wo-stage-nav" aria-label="办公室动作阶段">{DEMO_STAGES.map((item, index) => <button key={item.id} aria-label={`跳转到${item.label}`} aria-current={stage === item.id ? 'step' : undefined} onClick={() => jump(item.id)}><span>0{index + 1}</span><strong>{item.label}</strong><small>{item.durationMs / 1000}s</small></button>)}</nav>
    <p className="wo-footnote">独立空间与团队角色分别建模；自研 Agent 不会自动成为任务负责人。子 Actor 是复用自研外观的模拟派生实例。所有工作、摸鱼与异常均为演示脚本，不代表真实采集状态；接入层视图仍单独保留。</p>
  </section>;
}
