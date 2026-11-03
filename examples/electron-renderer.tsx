/** Mount inside an existing renderer root. No Node import or privileged Electron object. */
import { createRoot } from 'react-dom/client';
import { LiveOffice } from '../src/react';
import { createBridgeAdapter, parseOfficeConfig } from '../src/index';
import type { OfficeBridgeApi } from '../src/index';

export function mountAgentOffice(element: HTMLElement, publicConfiguration: unknown, api: OfficeBridgeApi) {
  const officeConfig = parseOfficeConfig(publicConfiguration);
  // Stable per-mount factory. Each setup gets a disposable adapter, including React Strict Mode.
  const adapterFactory = () => createBridgeAdapter(api);
  const root = createRoot(element);
  root.render(<LiveOffice adapterFactory={adapterFactory} officeConfig={officeConfig} modeLabel="采集服务 · 主进程桥接" />);
  return () => root.unmount();
}
// Host usage after loading its approved public configuration:
// const api = window.agentOffice;
// if (!api) showPreloadUnavailable(); else mountAgentOffice(rootElement, publicConfig, api);
