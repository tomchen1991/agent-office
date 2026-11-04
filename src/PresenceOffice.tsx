import { useEffect, useMemo, useState } from 'react';
import type { AdapterState, OfficeAdapter, OfficeTopology } from './core';
import { LiveOffice } from './LiveOffice';
import './display-only.css';

const emptyTopology: OfficeTopology = { selfAgentId: '__unbound_owner__', childAgentIds: [], team: { layout: 'independent-desks', memberIds: [] } };
export function PresenceOffice() {
  const [topology, setTopology] = useState(emptyTopology);
  const channel = useMemo(() => {
    let state: AdapterState = { phase: 'connecting', snapshot: null, error: null };
    const listeners = new Set<(state: AdapterState) => void>();
    const adapter: OfficeAdapter = { subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; }, connect() {}, dispose() {} };
    return { factory: () => adapter, publish(next: AdapterState) { state = next; listeners.forEach(fn => fn(next)); } };
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/api/office/presence', { signal: controller.signal, cache: 'no-store', redirect: 'error' });
        const body = await response.json();
        if (stopped) return;
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '读取状态失败');
        setTopology(body.topology);
        channel.publish({ phase: 'connected', snapshot: body.snapshot, error: null });
      } catch (error) {
        if (!stopped) channel.publish({ phase: 'disconnected', snapshot: null, error: error instanceof Error ? error.message : '读取状态失败' });
      } finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(poll, 5000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [channel]);
  return <main className="office-display-only"><LiveOffice adapterFactory={channel.factory} topology={topology} modeLabel="真实 presence · HTTP" /></main>;
}
