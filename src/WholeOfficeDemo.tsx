import { personalAssets, personalAssetsReady } from './personalIdle';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { demoCharacters } from './demoAssets';
import type { DemoCharacter } from './demoAssets';
import { DEMO_STAGES, TOTAL_DEMO_MS, demoPosition, demoReducer, initialDemoState } from './demoTimeline';
import type { DemoStage } from './demoTimeline';
import { startMotionClock } from './motionClock';
import { SIMULATED_CHILD_COUNT, wholeOfficeSeats } from './wholeOfficeGeometry';
import { WholeOfficeScene } from './WholeOfficeScene';
import './whole-office.css';
import { personalDemo, personalPose } from './personalIdle';

const assetUrl = (src: string) => `${import.meta.env.BASE_URL}${src}`;
export function WholeOfficeDemo({ characters = demoCharacters }: { characters?: readonly DemoCharacter[] } = {}) {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const layout = 'independent-desks' as const;
  const [reducedMotion, setReducedMotion] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [assets, setAssets] = useState<{ key: unknown; ready: boolean; failed: string[]; loaded: string[] }>({ key: characters, ready: false, failed: [], loaded: [] });
  const seats = useMemo(() => wholeOfficeSeats(layout, SIMULATED_CHILD_COUNT, characters.some(character => character.id === 'github' && character.ready)), [layout, characters]);
  const available = ['self', 'deepseek', 'chatgpt', 'grok', 'github'].every(id => characters.some(character => character.id === id && character.ready));

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
    setAssets({ key: characters, ready: false, failed: [], loaded: [] });
    // Base atlases gate the shared clock. Optional leisure art can arrive later without hiding the office.
    const required = [...new Set(characters.flatMap(character => [character.locomotion.src, character.seated.src]))];
    const sources = [...new Set(characters.flatMap(character => [character.locomotion.src, character.seated.src, ...personalAssets(character)]))];
    const publish = () => { if (alive) setAssets({ key: characters, ready: required.every(src => loaded.has(src)), failed: [...failed], loaded: [...loaded] }); };
    const images = sources.map(src => {
      const image = new Image();
      image.onload = () => { loaded.add(src); failed.delete(src); publish(); };
      image.onerror = () => { failed.add(src); publish(); };
      image.src = assetUrl(src);
      return image;
    });
    return () => { alive = false; for (const image of images) { image.onload = null; image.onerror = null; } };
  }, [characters, loadAttempt]);

  const canAnimate = available && assets.key === characters && assets.ready;
  useEffect(() => {
    if (!state.running || !canAnimate || reducedMotion) return;
    return startMotionClock({ request: callback => window.requestAnimationFrame(callback), cancel: handle => window.cancelAnimationFrame(handle) }, deltaMs => dispatch({ type: 'tick', deltaMs }));
  }, [state.running, canAnimate, reducedMotion]);

  const current = demoPosition(state);
  const { stage } = current;
  // Optional sheets may finish mid-cycle. Admit each role only at slack entry,
  // so a late load (even while paused) cannot teleport a seated actor outside.
  const [storedSlack, setStoredSlack] = useState<{ stage: DemoStage | null; characters: readonly DemoCharacter[]; reduced: boolean; roles: string[] }>({ stage: null, characters, reduced: reducedMotion, roles: [] });
  let slackSession = storedSlack;
  if (storedSlack.stage !== stage || storedSlack.characters !== characters) {
    const entering = stage === 'slack' && storedSlack.stage !== 'slack';
    slackSession = { stage, characters, reduced: reducedMotion, roles: entering && canAnimate && !reducedMotion
      ? characters.filter(item => personalAssetsReady(item, assets.loaded)).map(item => item.id) : [] };
    setStoredSlack(slackSession);
  }
  const activeStage = DEMO_STAGES.find(item => item.id === stage)!;
  const working = stage === 'work';
  const error = stage === 'error';
  const jump = (next: DemoStage) => { dispatch({ type: 'jump', stage: next }); dispatch({ type: 'pause' }); };
  const replay = () => { dispatch({ type: 'restart' }); if (reducedMotion) dispatch({ type: 'pause' }); };
  const status = !canAnimate ? '等待素材' : state.completed ? '演示结束' : reducedMotion ? '静帧查看' : state.running ? '演示中' : '已暂停';


  return <section className="whole-office-demo" aria-labelledby="whole-office-title" data-office-stage={stage} data-office-complete={state.completed} data-office-layout="fixed-office" data-office-assets-ready={canAnimate} data-office-reduced-motion={reducedMotion}>
    <div className="wo-heading"><h1 id="whole-office-title" className="sr-only">办公室</h1><span className="wo-demo-tag"><i />模拟演示</span></div>
    <WholeOfficeScene layout={layout} seats={seats} characters={characters} canAnimate={canAnimate} reducedMotion={reducedMotion} childCount={SIMULATED_CHILD_COUNT} worldStage={stage} floorLabel={activeStage.label} floorStatus={status} working={working} error={error} poseForSeat={seat => {
      if (seat.empty) return null;
      const role = seat.kind === 'owner' && seat.persona === 'self' ? 'self' : seat.kind === 'github' && seat.persona === 'github' ? 'github' : null;
      const action = role && stage === 'slack' && slackSession.roles.includes(role) ? personalDemo(role, current.stageElapsedMs) : undefined;
      return { ...current, ...(action ? personalPose(action) : {}), label: activeStage.label };
    }} loading={!canAnimate && <div className="wo-loading" role="status"><strong>{assets.failed.length ? '部分角色动作加载失败' : !available ? '角色动作素材尚未齐备' : '正在载入角色动作…'}</strong>{assets.failed.length > 0 && <button onClick={() => setLoadAttempt(value => value + 1)}>重新加载素材</button>}</div>}>
      <div className="wo-stage-summary"><div><span className="wo-step">0{DEMO_STAGES.findIndex(item => item.id === stage) + 1}</span><div><h2>{activeStage.label}</h2></div></div><time>{(state.elapsedMs / 1000).toFixed(1)} / {TOTAL_DEMO_MS / 1000} s</time></div>
      <div className="wo-progress" role="progressbar" aria-label="办公室完整演示进度" aria-valuemin={0} aria-valuemax={TOTAL_DEMO_MS} aria-valuenow={state.elapsedMs}><span style={{ width: `${state.elapsedMs / TOTAL_DEMO_MS * 100}%` }} /></div>
    </WholeOfficeScene>
    <div className="wo-controls"><div><button className="wo-primary" aria-label={state.running ? '暂停办公室演示' : '播放办公室演示'} disabled={reducedMotion || (!canAnimate && !state.running)} onClick={() => dispatch({ type: state.running ? 'pause' : 'play' })}>{state.running ? '暂停演示' : state.completed ? '再看一次' : '继续播放'}</button><button aria-label="重播办公室演示" disabled={!canAnimate} onClick={replay}>从头重播</button></div><label className="wo-motion-preference"><input type="checkbox" checked={reducedMotion} onChange={event => { setReducedMotion(event.target.checked); if (event.target.checked) dispatch({ type: 'pause' }); }} />减少动态效果</label>{reducedMotion && <p role="status">静帧模式</p>}</div>
    <nav className="wo-stage-nav" aria-label="办公室动作阶段">{DEMO_STAGES.map((item, index) => <button key={item.id} aria-label={`跳转到${item.label}`} aria-current={stage === item.id ? 'step' : undefined} onClick={() => jump(item.id)}><span>0{index + 1}</span><strong>{item.label}</strong><small>{item.durationMs / 1000}s</small></button>)}</nav>
  </section>;
}
