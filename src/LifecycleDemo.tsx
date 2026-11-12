import { seatedBreakRole, seatedBreakFrame, seatedBreakAnimations } from './seatedBreak';
import { useEffect, useReducer, useState } from 'react';
import type { CSSProperties } from 'react';
import { DEMO_STAGES, TOTAL_DEMO_MS, initialDemoState, demoPosition, demoReducer, demoFrame } from './demoTimeline';
import type { DemoStage } from './demoTimeline';
import { demoCharacters } from './demoAssets';
import type { DemoCharacter } from './demoAssets';
import { startMotionClock } from './motionClock';
import { seatingPose, seatingPlacement, SEATED_CONTACT_Y, DEMO_SPRITE_WIDTH_PERCENT } from './demoSeating';
import './lifecycle.css';

const stageDescriptions: Record<DemoStage, string> = {
  arrival: '从门口沿地面路线走向工位。',
  sit: '到达椅子前，转入落座动作。',
  work: '坐在办公桌后，敲键盘处理任务。',
  slack: '坐在工位上休息片刻。',
  error: '任务遇到异常，角色与屏幕同步提示。',
  stand: '结束当前任务，从椅子上起身。',
  exit: '沿原路离开，在门口结束这次演示。',
};

export function LifecycleDemo({ characters = demoCharacters }: {characters?: readonly DemoCharacter[]} = {}) {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [selectedId, setSelectedId] = useState<DemoCharacter['id']>('self');
  const character = characters.find(item => item.id === selectedId)!;
  const [loadedBreak, setLoadedBreak] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const assetError = errorId === selectedId;
  const assetUrl = (src: string) => `${import.meta.env.BASE_URL}${src}`;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => { setReducedMotion(media.matches); if (media.matches) dispatch({ type: 'pause' }); };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  useEffect(() => {
    setLoadedId(null); setErrorId(null); setLoadedBreak(null);
    if (!character.ready) return;
    let alive = true;
    let count = 0;
    const images = [character.locomotion.src, character.seated.src].map(src => {
      const image = new Image();
      image.onload = () => { if (alive && ++count === 2) setLoadedId(character.id); };
      image.onerror = () => { if (alive) setErrorId(character.id); };
      image.src = assetUrl(src);
      return image;
    });
    if (character.seatedBreak) {
      const src = character.seatedBreak.src;
      const image = new Image();
      image.onload = () => { if (alive) setLoadedBreak(src); };
      // Optional load failure keeps the normal seated fallback and controls usable.
      image.src = assetUrl(src);
      images.push(image);
    }
    return () => { alive = false; for (const image of images) { image.onload = null; image.onerror = null; } };
  }, [character]);
  const canAnimate = character.ready && loadedId === selectedId && !assetError;
  useEffect(() => {
    if (!state.running || !canAnimate || reducedMotion) return;
    return startMotionClock({ request: callback => window.requestAnimationFrame(callback), cancel: handle => window.cancelAnimationFrame(handle) }, deltaMs => dispatch({ type: 'tick', deltaMs }));
  }, [state.running, canAnimate, reducedMotion]);

  const { stage, stageElapsedMs, progress } = demoPosition(state);
  const seated = stage === 'work' || stage === 'slack' || stage === 'error';
  const breakRole = seatedBreakRole(character, loadedBreak ? [loadedBreak] : []);
  const [storedBreak, setStoredBreak] = useState<{ character: DemoCharacter; stage: DemoStage | null; admitted: boolean }>({ character, stage: null, admitted: false });
  let breakSession = storedBreak;
  if (storedBreak.character !== character || storedBreak.stage !== stage) {
    breakSession = { character, stage, admitted: stage === 'slack' && Boolean(breakRole) && !reducedMotion };
    setStoredBreak(breakSession);
  }
  const breakActive = stage === 'slack' && breakSession.admitted && breakRole && !reducedMotion;
  const { sheet, frame } = breakActive ? { sheet: 'seatedBreak' as const, frame: seatedBreakFrame(breakRole, stageElapsedMs) } : demoFrame({ stage, stageElapsedMs, progress }, reducedMotion);
  const atlas = character[sheet] ?? character.seated;
  const stageDescription = breakActive ? `在工位上${seatedBreakAnimations[breakRole].label}。` : stageDescriptions[stage];
  // World-space contact points, not a collection of unrelated status cards.
  const travel = stage === 'arrival' ? progress : stage === 'exit' ? 1 - progress : 1;
  const transitionPose = stage === 'sit' || stage === 'stand' ? seatingPose(stage, stageElapsedMs, reducedMotion) : null;
  const transitionPlacement = transitionPose ? seatingPlacement(transitionPose, character.locomotion.anchor, character.seated.anchor) : null;
  const mirrored = transitionPose?.mirrored ?? stage === 'exit';
  const x = transitionPlacement?.x ?? (seated ? 68 : 13 + 55 * travel);
  const y = transitionPlacement?.y ?? (seated ? SEATED_CONTACT_Y : 79 - 12 * travel);
  const contactX = transitionPlacement?.contactX ?? (mirrored ? 1 - atlas.anchor.x : atlas.anchor.x);
  const contactY = transitionPlacement?.contactY ?? atlas.anchor.y;
  const opacity = stage === 'exit' ? Math.min(1, (1 - progress) * 9) : 1;
  const spriteStyle = {
    left: `${x}%`, top: `${y}%`,
    width: `${DEMO_SPRITE_WIDTH_PERCENT}%`,
    '--contact-x': `${contactX * 100}%`, '--contact-y': `${contactY * 100}%`,
    '--sprite-ratio': `${atlas.cellWidth} / ${atlas.cellHeight}`,
    opacity: reducedMotion ? 1 : opacity,
  } as CSSProperties;
  const frameStyle: CSSProperties = {
    backgroundImage: `url("${assetUrl(atlas.src)}")`,
    backgroundSize: `${atlas.columns * 100}% ${atlas.rows * 100}%`,
    backgroundPosition: `${(frame % atlas.columns) / (atlas.columns - 1) * 100}% ${Math.floor(frame / atlas.columns) / (atlas.rows - 1) * 100}%`,
    transform: mirrored ? 'scaleX(-1)' : undefined,
  };
  const activeStage = DEMO_STAGES.find(item => item.id === stage)!;
  const working = stage === 'work';
  const error = stage === 'error';
  const workBeat = reducedMotion ? 0 : Math.floor(stageElapsedMs / 260);
  const workLines = [0, 1, 2].map(index => working ? 28 + ((workBeat * 13 + index * 19) % 60) : 50 - index * 10);
  const jumpTo = (next: DemoStage) => { dispatch({ type: 'jump', stage: next }); dispatch({ type: 'pause' }); };
  return <section className="lifecycle-demo" aria-labelledby="lifecycle-title" data-demo-stage={stage} data-demo-complete={state.completed} data-demo-character={selectedId}>
    <div className="lifecycle-heading"><h1 id="lifecycle-title" className="sr-only">角色动作</h1><span className="lc-demo-badge">模拟演示</span></div>
    <nav className="lc-character-nav" aria-label="角色选择">{characters.map(item => <button key={item.id} className={`lc-character-choice character-${item.id}`} aria-pressed={selectedId === item.id} onClick={() => { setSelectedId(item.id); dispatch({type:'restart'}); if (reducedMotion) dispatch({type:'pause'}); }}><strong>{item.label}</strong>{!item.ready && <span>素材准备中</span>}</button>)}</nav>
    <div className="lc-stage-wrap">
      <div className={`lc-world lc-${stage}`} role="img" aria-label={`${character.label} 的像素办公室场景：${activeStage.label}。${stageDescription}`}>
        <div className="lc-wall"><div className="lc-window"><span /><span /><span /><span /></div><div className="lc-board"></div><div className="lc-wall-trim" /></div>
        <div className="lc-floor" />
        <div className="lc-route" aria-hidden="true"><span>→</span><span>→</span><span>→</span><span>→</span></div>
        <div className="lc-door"><span className="lc-door-plaque" /><div className="lc-door-inner"><span className="lc-door-handle" /></div><span className="lc-door-mat" /></div>
        <div className="lc-plant"><div className="lc-leaves">✦</div><div className="lc-pot" /></div>
        {selectedId === 'self' && <svg className="lc-scythe-rack" viewBox="0 0 90 180" role="img" aria-label="停放在工位旁的星月镰刀"><path d="M42 35 L52 167" stroke="#5a365f" strokeWidth="9"/><path d="M42 35 L52 167" stroke="#cca0e2" strokeWidth="4"/><path d="M12 39 Q42 -3 82 30 Q52 16 28 51Z" fill="#d8b5ed" stroke="#63417c" strokeWidth="3"/><path d="M44 24 L55 35 L46 47 L35 35Z" fill="#9c57cc" stroke="#f0d6ff" strokeWidth="2"/><path d="M27 47 L22 66 L34 60Z" fill="#aa78c8"/><path d="M35 164 H70 L75 174 H30Z" fill="#684575"/><circle cx="59" cy="53" r="5" fill="#ead7a0"/></svg>}
        <div className="lc-chair"><span className="lc-chair-back" /><span className="lc-chair-seat" /><span className="lc-chair-leg" /></div>
        <div className="lc-desk-back" />
        <div className="lc-monitor"><div className={`lc-screen ${working ? 'screen-work' : ''} ${error ? 'screen-error' : ''}`}><span>{error ? '!' : working ? '>_' : stage === 'slack' ? '☕' : '···'}</span>{workLines.map((width, index) => <i key={index} style={{width: `${width}%`}} />)}{working && <b className="lc-screen-progress" style={{width: `${Math.round(progress * 100)}%`}} />}</div><div className="lc-monitor-neck" /></div>
        {canAnimate && <div className="lc-character" style={spriteStyle} aria-hidden="true"><div className="lc-sprite-frame" data-demo-frame={frame} data-demo-sheet={sheet} style={frameStyle} /></div>}
        <div className="lc-desk-front"><span className="lc-desk-top" /><span className="lc-keyboard" data-demo-workbeat={working ? workBeat : undefined}>{[0, 1, 2, 3, 4, 5, 6, 7].map(key => <i key={key} className={working && !reducedMotion && key === workBeat % 8 ? 'key-pressed' : ''} />)}</span><span className="lc-cup">☕</span><span className="lc-desk-leg left" /><span className="lc-desk-leg right" /></div>
        {error && <div className="lc-error-note" role="img" aria-label="任务异常，等待处理">!</div>}
      </div>
        {!canAnimate && <div className="lc-asset-pending" role="status">{assetError ? '角色帧加载失败，请重新载入页面。' : !character.ready ? '动作素材准备中' : '正在载入角色动作…'}</div>}
      <div className="lc-stage-summary"><time>{(state.elapsedMs / 1000).toFixed(1)} / {(TOTAL_DEMO_MS / 1000).toFixed(0)} s</time></div>
      <div className="lc-progress" role="progressbar" aria-label="完整演示进度" aria-valuemin={0} aria-valuemax={TOTAL_DEMO_MS} aria-valuenow={state.elapsedMs}><span style={{ width: `${state.elapsedMs / TOTAL_DEMO_MS * 100}%` }} /></div>
    </div>
    <div className="lc-controls"><div><button className="lc-primary" aria-label={state.running ? '暂停' : state.completed ? '重新播放' : '播放'} disabled={!canAnimate || reducedMotion} onClick={() => dispatch({ type: state.running ? 'pause' : state.completed ? 'restart' : 'play' })}>{state.running ? '暂停演示' : state.completed ? '再看一次' : '继续播放'}</button><button aria-label="从头重新播放" disabled={!canAnimate} onClick={() => { dispatch({ type: 'restart' }); if (reducedMotion) dispatch({ type: 'pause' }); }}>从头开始</button></div>{reducedMotion && <p role="status">静帧模式</p>}</div>
    <nav className="lc-stage-nav" aria-label="动作阶段">{DEMO_STAGES.map((item, index) => <button key={item.id} aria-current={stage === item.id ? 'step' : undefined} onClick={() => jumpTo(item.id)}><span>0{index + 1}</span><strong>{item.label}</strong><small>{item.durationMs / 1000}s</small></button>)}</nav>
  </section>;
}
