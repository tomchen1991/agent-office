import { useEffect, useMemo, useReducer, useState } from 'react';
import { demoCharacters } from './demoAssets';
import type { DemoCharacter } from './demoAssets';
import { DEMO_STAGES, TOTAL_DEMO_MS, demoPosition, demoReducer, initialDemoState } from './demoTimeline';
import type { DemoStage } from './demoTimeline';
import { startMotionClock } from './motionClock';
import { SIMULATED_CHILD_COUNT, wholeOfficeSeats } from './wholeOfficeGeometry';
import { WholeOfficeScene } from './WholeOfficeScene';
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
export function WholeOfficeDemo({ characters = demoCharacters }: { characters?: readonly DemoCharacter[] } = {}) {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemoState);
  const layout = 'independent-desks' as const;
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
  const { stage } = current;
  const activeStage = DEMO_STAGES.find(item => item.id === stage)!;
  const working = stage === 'work';
  const error = stage === 'error';
  const jump = (next: DemoStage) => { dispatch({ type: 'jump', stage: next }); dispatch({ type: 'pause' }); };
  const replay = () => { dispatch({ type: 'restart' }); if (reducedMotion) dispatch({ type: 'pause' }); };
  const status = !canAnimate ? '等待素材' : state.completed ? '演示结束' : reducedMotion ? '静帧查看' : state.running ? '演示中' : '已暂停';


  return <section className="whole-office-demo" aria-labelledby="whole-office-title" data-office-stage={stage} data-office-complete={state.completed} data-office-layout="fixed-office" data-office-assets-ready={canAnimate} data-office-reduced-motion={reducedMotion}>
    <div className="wo-heading"><div><span className="wo-kicker">AGENT OFFICE / THE WHOLE STUDIO</span><h1 id="whole-office-title">同一间办公室，一起上一天班。</h1><p>自研 Agent 有自己的房间。团队有自己的协作方式。只有已分配角色的席位播放动作，空位不会凭空生成 Agent。</p></div><span className="wo-demo-tag"><i /> 26 秒完整演示 · 模拟数据</span></div>
    <div className="wo-toolbar"><p>固定办公室：主办公室 1 个大工位 + 1 张协作桌；公共区域 3 张协作桌 + 10 个独立工位。每张协作桌 3 席，所有位置同时存在。</p><span className="wo-demo-tag">23 个实体席位 · 空位保留</span></div>
    <WholeOfficeScene layout={layout} seats={seats} characters={characters} canAnimate={canAnimate} reducedMotion={reducedMotion} childCount={SIMULATED_CHILD_COUNT} worldStage={stage} floorLabel={activeStage.label} floorStatus={status} working={working} error={error} poseForSeat={seat => seat.empty ? null : ({ ...current, label: activeStage.label })} loading={!canAnimate && <div className="wo-loading" role="status"><strong>{assets.failed.length ? '部分角色动作加载失败' : !available ? '角色动作素材尚未齐备' : '正在载入四位角色的完整动作…'}</strong><span>全部 8 张动作图集就绪后，整间办公室才会一起开始。</span>{assets.failed.length > 0 && <button onClick={() => setLoadAttempt(value => value + 1)}>重新加载素材</button>}</div>}>
      <div className="wo-stage-summary"><div><span className="wo-step">0{DEMO_STAGES.findIndex(item => item.id === stage) + 1}</span><div><h2>{activeStage.label}</h2><p>{descriptions[stage]}</p></div></div><time>{(state.elapsedMs / 1000).toFixed(1)} / {TOTAL_DEMO_MS / 1000} s</time></div>
      <div className="wo-progress" role="progressbar" aria-label="办公室完整演示进度" aria-valuemin={0} aria-valuemax={TOTAL_DEMO_MS} aria-valuenow={state.elapsedMs}><span style={{ width: `${state.elapsedMs / TOTAL_DEMO_MS * 100}%` }} /></div>
    </WholeOfficeScene>
    <div className="wo-controls"><div><button className="wo-primary" aria-label={state.running ? '暂停办公室演示' : '播放办公室演示'} disabled={reducedMotion || (!canAnimate && !state.running)} onClick={() => dispatch({ type: state.running ? 'pause' : 'play' })}>{state.running ? '暂停演示' : state.completed ? '再看一次' : '继续播放'}</button><button aria-label="重播办公室演示" disabled={!canAnimate} onClick={replay}>从头重播</button></div><label className="wo-motion-preference"><input type="checkbox" checked={reducedMotion} onChange={event => { setReducedMotion(event.target.checked); if (event.target.checked) dispatch({ type: 'pause' }); }} />减少动态效果</label><p>{reducedMotion ? '已暂停动态播放，可选择阶段查看静帧。' : '固定布局 · 空位始终保留 · 选择阶段会暂停'}</p></div>
    <nav className="wo-stage-nav" aria-label="办公室动作阶段">{DEMO_STAGES.map((item, index) => <button key={item.id} aria-label={`跳转到${item.label}`} aria-current={stage === item.id ? 'step' : undefined} onClick={() => jump(item.id)}><span>0{index + 1}</span><strong>{item.label}</strong><small>{item.durationMs / 1000}s</small></button>)}</nav>
    <p className="wo-footnote">独立空间与团队角色分别建模；自研 Agent 不会自动成为任务负责人。子 Actor 是复用自研外观的模拟派生实例。所有工作、摸鱼与异常均为演示脚本，不代表真实采集状态；接入层视图仍单独保留。</p>
  </section>;
}
