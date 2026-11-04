import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import './agent-dialog.css';

export function AgentDialog({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="agent-dialog" aria-labelledby="live-details-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}>
    <button className="agent-dialog-close" autoFocus onClick={onClose} aria-label="关闭 Agent 详情">×</button>
    {children}
  </dialog>;
}
