import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './devops-monitor.css';

/** Visual office fixture only. Service data integration is owned by the host. */
export function DevopsMonitor({ compact = true }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (expanded && !dialog.current?.open) dialog.current?.showModal();
  }, [expanded]);

  const close = () => {
    setExpanded(false);
    trigger.current?.focus();
  };

  return <>
    <section className={`devops-monitor${compact ? ' devops-monitor--compact' : ''}`} aria-label="DevOps 服务监控" onPointerDown={event => event.stopPropagation()}>
      <header><strong>DEVOPS <span>服务监控</span></strong><span className="devops-connection">未连接</span></header>
      <div className="devops-empty"><strong>未连接服务数据源</strong><span>展示占位 · 暂无服务状态</span></div>
      <footer><span>办公室展示屏</span><button ref={trigger} type="button" onClick={() => setExpanded(true)}>查看详情</button></footer>
    </section>
    {expanded && createPortal(<dialog className="devops-monitor-dialog" ref={dialog} onPointerDown={event => event.stopPropagation()} aria-label="DevOps 服务监控详情" onCancel={event => { event.preventDefault(); close(); }} onClose={close}>
      <header><h2>DevOps 服务监控</h2><button type="button" autoFocus onClick={close}>关闭</button></header>
      <p>未连接服务数据源</p>
      <p className="devops-detail-note">此处仅为办公室大屏的视觉占位，暂无真实服务状态。</p>
    </dialog>, document.body)}
  </>;
}
