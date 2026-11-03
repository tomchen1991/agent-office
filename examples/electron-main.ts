/** Host integration recipe, typechecked without installing or pretending to run Electron.
 * In your Electron main entry, supply ipcMain and options => new BrowserWindow(options).
 */
import { isAbsolute } from 'node:path';
import { createCollectAdapter } from '../server/collect.ts';
import type { CollectOptions } from '../server/collect.ts';
import { registerOfficeIpc } from '../server/electronBridge.ts';
import type { OfficeIpcMain, OfficeWebContents } from '../server/electronBridge.ts';

export function officeWindowOptions(preloadPath: string) {
  if (!isAbsolute(preloadPath)) throw new Error('Provide the absolute bundled preload path');
  return {
    width: 1280, height: 860,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      // Non-persistent, dedicated session. Do not reuse a privileged app session.
      partition: 'agent-office',
    },
  } as const;
}
interface ExampleWindow {
  webContents: OfficeWebContents & {
    setWindowOpenHandler(handler: () => {action: 'deny'}): void;
    session: {
      setPermissionRequestHandler(handler: (contents: unknown, permission: string, callback: (allowed: boolean) => void) => void): void;
      setPermissionCheckHandler(handler: () => boolean): void;
    };
  };
  loadURL(url: string): Promise<void>;
  destroy(): void;
}
interface ElectronMainDependencies {
  ipcMain: OfficeIpcMain;
  createWindow(options: ReturnType<typeof officeWindowOptions>): ExampleWindow;
}
interface TrustedHostSettings {
  /** Example: app://agent-office/index.html after registering a standard, secure app: protocol. */
  rendererURL: string;
  rendererOrigin: string;
  preloadPath: string;
  /** Main-only settings. token() should read the host's existing secret store, not renderer input. */
  collector: Pick<CollectOptions, 'baseURL' | 'token' | 'sourceId' | 'pollMs' | 'timeoutMs'>;
}

/** Call once after app readiness. Call dispose() at app shutdown. */
export function createCollectorOfficeHost(electron: ElectronMainDependencies) {
  const bridge = registerOfficeIpc(electron.ipcMain);
  const cleanups = new Set<() => void>();
  return {
    async openWindow(settings: TrustedHostSettings) {
      const window = electron.createWindow(officeWindowOptions(settings.preloadPath));
      const contents = window.webContents;
      const blockNavigation = (event: unknown) => {
        if (event && typeof event === 'object' && 'preventDefault' in event && typeof event.preventDefault === 'function') event.preventDefault();
      };
      contents.setWindowOpenHandler(() => ({action: 'deny'}));
      contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      contents.session.setPermissionCheckHandler(() => false);
      contents.on('will-navigate', blockNavigation);
      contents.on('will-redirect', blockNavigation);
      // No renderer-provided endpoint, token, request summary, identity mapping or config.
      const collector = {...settings.collector};
      let detach: (() => void) | undefined;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true; cleanups.delete(close); detach?.();
        contents.removeListener('will-navigate', blockNavigation);
        contents.removeListener('will-redirect', blockNavigation);
        contents.removeListener('destroyed', close);
      };
      try {
        detach = bridge.attachWindow({
          webContents: contents,
          allowedDocument: {url: settings.rendererURL, origin: settings.rendererOrigin},
          createAdapter: () => createCollectAdapter(collector),
        });
        cleanups.add(close); contents.on('destroyed', close);
        // Register before loading: document commit authorizes the exact main frame.
        await window.loadURL(settings.rendererURL);
        return {window, detach: close};
      } catch {
        close(); window.destroy(); throw new Error('Office window could not be opened');
      }
    },
    dispose() {
      for (const close of [...cleanups]) close();
      bridge.dispose();
    },
  };
}
