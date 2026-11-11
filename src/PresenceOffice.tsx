import { useEffect, useMemo, useState } from 'react';
import type { AdapterState, OfficeAdapter, OfficeTopology } from './core';
import { LiveOffice } from './LiveOffice';
import { connectPresenceStream } from './presenceStream';
import './display-only.css';

const emptyTopology: OfficeTopology = { selfAgentId: '__unbound_owner__', childAgentIds: [], team: { layout: 'independent-desks', memberIds: [] } };
export function PresenceOffice() {
  const [topology, setTopology] = useState(emptyTopology);
  const channel = useMemo(() => {
    let state: AdapterState = { phase: 'connecting', snapshot: null, error: null };
    const listeners = new Set<(state: AdapterState) => void>();
    const adapter: OfficeAdapter = { subscribe(listener) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; }, connect() {}, dispose() {} };
    return { factory: () => adapter, publish(next: AdapterState | ((previous: AdapterState) => AdapterState)) { state = typeof next === 'function' ? next(state) : next; listeners.forEach(fn => fn(state)); } };
  }, []);
  useEffect(() => connectPresenceStream(channel.publish, setTopology), [channel]);
  return <main className="office-display-only"><LiveOffice adapterFactory={channel.factory} topology={topology} modeLabel="真实 presence · 直连采集服务" /></main>;
}
