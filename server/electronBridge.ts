/** Electron main only. Dependency-injected to keep Electron out of the browser bundle. */
import type { OfficeAdapter } from '../src/core.ts';
import { OFFICE_BRIDGE_CHANNELS, OFFICE_BRIDGE_ERROR, parseBridgeCommand, sanitizeBridgeState } from '../src/bridgeProtocol.ts';
import type { OfficeBridgeEvent, OfficeBridgeReply } from '../src/bridgeProtocol.ts';

export interface OfficeMainFrame {
  readonly url: string;
  readonly origin: string;
  send(channel: string, payload: OfficeBridgeEvent): void;
}
export interface OfficeWebContents {
  readonly mainFrame: OfficeMainFrame;
  getURL(): string;
  isDestroyed(): boolean;
  isLoadingMainFrame(): boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}
export interface OfficeIpcEvent { sender: OfficeWebContents; senderFrame: OfficeMainFrame | null }
export interface OfficeIpcMain {
  handle(channel: string, listener: (event: OfficeIpcEvent, ...args: unknown[]) => OfficeBridgeReply): void;
  removeHandler(channel: string): void;
}
export interface OfficeWindowOptions {
  webContents: OfficeWebContents;
  /** Host-owned canonical document URL and serialized frame origin, both exact matches. */
  allowedDocument: { url: string; origin: string };
  /** New private adapter per subscription. Never accept configuration from the renderer. */
  createAdapter(): OfficeAdapter;
}
export interface OfficeMainBridge {
  attachWindow(options: OfficeWindowOptions): () => void;
  dispose(): void;
}
interface Endpoint {
  options: OfficeWindowOptions;
  detached: boolean;
  navigating: boolean;
  recoverableNavigation: boolean;
  frame: OfficeMainFrame | null;
  subscriptionId: number | null;
  highestId: number;
  generation: number;
  adapter: OfficeAdapter | null;
  cancel: (() => void) | null;
  changes: number[];
  handlers: [string, (...args: unknown[]) => void][];
}
const registered = new WeakSet<object>();
const failed = (): OfficeBridgeReply => ({ok: false, error: OFFICE_BRIDGE_ERROR});

function validateDocument(document: OfficeWindowOptions['allowedDocument']): void {
  const url = new URL(document.url);
  const origin = new URL(document.origin);
  // Custom protocols must be registered as standard + secure by the host. Opaque/file
  // origins are never authorized; the supplied frame.origin must independently agree.
  if (document.url.length > 2048 || document.origin.length > 512 || !url.hostname || url.username || url.password || url.hash || url.search ||
      !['https:', 'http:', 'app:'].includes(url.protocol) || url.href !== document.url ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ||
      origin.username || origin.password || origin.hash || origin.search || origin.pathname !== (origin.protocol === 'http:' || origin.protocol === 'https:' ? '/' : '') ||
      document.origin !== `${url.protocol}//${url.host}` || `${origin.protocol}//${origin.host}` !== document.origin) throw new Error('Invalid office document policy');
}
function isMainNavigation(args: unknown[]): boolean {
  const details = args[0];
  if (details && typeof details === 'object' && 'isMainFrame' in details && typeof details.isMainFrame === 'boolean') return details.isMainFrame;
  // Compatibility with Electron's documented legacy positional navigation arguments.
  return args[3] === true;
}
function documentMatches(endpoint: Endpoint): boolean {
  try {
    const {webContents, allowedDocument} = endpoint.options;
    const frame = webContents.mainFrame;
    return !endpoint.detached && !webContents.isDestroyed() && frame.url === allowedDocument.url && frame.origin === allowedDocument.origin && webContents.getURL() === allowedDocument.url;
  } catch { return false; }
}
function authorized(endpoint: Endpoint, event: OfficeIpcEvent): boolean {
  try {
    return !endpoint.navigating && event.sender === endpoint.options.webContents && event.senderFrame !== null &&
      event.senderFrame === endpoint.frame && event.senderFrame === event.sender.mainFrame && documentMatches(endpoint);
  } catch { return false; }
}
function stop(endpoint: Endpoint): void {
  endpoint.generation++;
  endpoint.subscriptionId = null;
  const cancel = endpoint.cancel; const adapter = endpoint.adapter;
  endpoint.cancel = null; endpoint.adapter = null;
  try { cancel?.(); } catch { /* No raw exception crosses IPC; still dispose the adapter. */ }
  try { adapter?.dispose(); } catch { /* Host adapter cleanup remains isolated. */ }
}

/** Register exactly once per ipcMain; attach only host-approved BrowserWindows. */
export function registerOfficeIpc(ipcMain: OfficeIpcMain): OfficeMainBridge {
  if (registered.has(ipcMain)) throw new Error('Office IPC is already registered');
  const endpoints = new Map<OfficeWebContents, Endpoint>();
  let disposed = false;
  const detach = (endpoint: Endpoint) => {
    if (endpoint.detached) return;
    endpoint.detached = true; stop(endpoint);
    endpoints.delete(endpoint.options.webContents);
    for (const [event, handler] of endpoint.handlers) endpoint.options.webContents.removeListener(event, handler);
  };
  ipcMain.handle(OFFICE_BRIDGE_CHANNELS.control, (event, ...args) => {
    try {
      const endpoint = endpoints.get(event.sender);
      if (disposed || !endpoint || !authorized(endpoint, event) || args.length !== 1) return failed();
      const command = parseBridgeCommand(args[0]);
      if (!command) return failed();
      if (command.action === 'unsubscribe') {
        if (command.subscriptionId === endpoint.subscriptionId) stop(endpoint);
        return {ok: true};
      }
      if (command.subscriptionId === endpoint.subscriptionId) return {ok: true};
      if (command.subscriptionId <= endpoint.highestId) return failed();
      const now = Date.now();
      endpoint.changes = endpoint.changes.filter(time => now - time < 1000);
      if (endpoint.changes.length >= 20) return failed();
      endpoint.changes.push(now); endpoint.highestId = command.subscriptionId;
      stop(endpoint);
      endpoint.subscriptionId = command.subscriptionId;
      const generation = endpoint.generation;
      const frame = event.senderFrame!;
      try {
        const adapter = endpoint.options.createAdapter();
        endpoint.adapter = adapter;
        endpoint.cancel = adapter.subscribe(state => {
          if (endpoint.generation !== generation || endpoint.subscriptionId !== command.subscriptionId || !authorized(endpoint, {sender: endpoint.options.webContents, senderFrame: frame})) return;
          try { frame.send(OFFICE_BRIDGE_CHANNELS.state, {subscriptionId: command.subscriptionId, state: sanitizeBridgeState(state)}); }
          catch { stop(endpoint); }
        });
        // subscribe may synchronously trigger navigation or close the window.
        if (endpoint.generation === generation && authorized(endpoint, event)) adapter.connect();
        else stop(endpoint);
        return {ok: true};
      } catch { stop(endpoint); return failed(); }
    } catch { return failed(); }
  });
  registered.add(ipcMain);
  return {
    attachWindow(options) {
      validateDocument(options.allowedDocument);
      if (disposed || options.webContents.isDestroyed() || endpoints.has(options.webContents)) throw new Error('Office window cannot be attached');
      // Copy host policy so later accidental mutation cannot expand a window's authority.
      const endpoint: Endpoint = { options: {...options, allowedDocument: {...options.allowedDocument}}, detached: false, navigating: false, recoverableNavigation: false, frame: null,
        subscriptionId: null, highestId: 0, generation: 0, adapter: null, cancel: null, changes: [], handlers: [] };
      if (documentMatches(endpoint)) endpoint.frame = options.webContents.mainFrame;
      const start = (...args: unknown[]) => {
        if (!isMainNavigation(args)) return;
        endpoint.navigating = true; endpoint.recoverableNavigation = true; endpoint.frame = null; stop(endpoint);
      };
      const committed = () => {
        endpoint.navigating = false; endpoint.recoverableNavigation = false;
        endpoint.frame = documentMatches(endpoint) ? options.webContents.mainFrame : null;
        // A new document gets a new preload sequence, never old subscriptions or snapshots.
        endpoint.highestId = 0;
      };
      const inPage = (...args: unknown[]) => {
        const details = args[0];
        const main = details && typeof details === 'object' && 'isMainFrame' in details ? details.isMainFrame === true : args[2] === true;
        if (main) { endpoint.navigating = false; endpoint.recoverableNavigation = false; endpoint.frame = documentMatches(endpoint) ? options.webContents.mainFrame : null; }
      };
      const recover = () => {
        // A canceled/failed navigation can leave the original trusted document alive.
        // Do not restore a cached stream, or authorize while a newer navigation runs.
        if (endpoint.navigating && endpoint.recoverableNavigation && !options.webContents.isLoadingMainFrame() && documentMatches(endpoint)) {
          endpoint.navigating = false; endpoint.recoverableNavigation = false; endpoint.frame = options.webContents.mainFrame;
        }
      };
      const failedLoad = (...args: unknown[]) => { if (args[4] === true) recover(); };
      const gone = () => { endpoint.navigating = true; endpoint.recoverableNavigation = false; endpoint.frame = null; stop(endpoint); };
      endpoint.handlers = [ ['did-start-navigation', start], ['did-navigate', committed], ['did-navigate-in-page', inPage], ['did-fail-load', failedLoad], ['did-fail-provisional-load', failedLoad], ['did-stop-loading', recover], ['render-process-gone', gone], ['destroyed', () => detach(endpoint)] ];
      endpoints.set(options.webContents, endpoint);
      for (const [event, handler] of endpoint.handlers) options.webContents.on(event, handler);
      return () => detach(endpoint);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const endpoint of [...endpoints.values()]) detach(endpoint);
      ipcMain.removeHandler(OFFICE_BRIDGE_CHANNELS.control); registered.delete(ipcMain);
    },
  };
}
