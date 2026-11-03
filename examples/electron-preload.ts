/** Bundle this recipe as a sandbox-compatible preload (typically one CommonJS file).
 * Your preload entry imports {contextBridge, ipcRenderer} from 'electron' and passes
 * those two objects here. Never expose either object directly to window.
 */
import { exposeOfficePreload } from '../src/bridge.ts';
import type { OfficeContextBridge, OfficeIpcRenderer } from '../src/bridge.ts';
import type { OfficeBridgeApi } from '../src/bridgeProtocol.ts';

export function installAgentOfficePreload(electron: {contextBridge: OfficeContextBridge; ipcRenderer: OfficeIpcRenderer}): void {
  exposeOfficePreload(electron.contextBridge, electron.ipcRenderer);
}

declare global {
  interface Window { agentOffice?: OfficeBridgeApi }
}
