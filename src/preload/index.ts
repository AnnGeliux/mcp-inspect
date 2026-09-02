/**
 * Preload: exposes safe IPC to the renderer.
 * contextIsolation: true -> we cannot share variables, only via window.api.
 *
 * M1 (multi-server): every stateful call takes a serverId — the renderer
 * runs one session per started server and shows a tab for each.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  LogEntry,
  ServerConfig,
  SessionInfo,
  JsonRpcMessage,
  SavedServer,
  SavedClient,
  InterceptRule,
  HeldMessage,
  HoldResolution,
  SimulationConfig,
} from '../shared/types';

/** Intercept state of one session. */
export interface InterceptState {
  serverId: string;
  rules: InterceptRule[];
  interceptAllC2s: boolean;
  interceptAllS2c: boolean;
  held: HeldMessage[];
  paused?: boolean;
  queue?: { c2s: number; s2c: number };
}

const api = {
  // ---------- proxy (per-session server subprocess) ----------
  start: (serverId: string, name: string, config: ServerConfig) =>
    ipcRenderer.invoke('proxy:start', { serverId, name, config }),
  stop: (serverId: string) => ipcRenderer.invoke('proxy:stop', { serverId }),
  restart: (serverId: string) => ipcRenderer.invoke('proxy:restart', { serverId }),
  killServer: (serverId: string) => ipcRenderer.invoke('proxy:kill', { serverId }),
  pauseServer: (serverId: string) => ipcRenderer.invoke('proxy:pause', { serverId }),
  resumeServer: (serverId: string) => ipcRenderer.invoke('proxy:resume', { serverId }),
  write: (serverId: string, msg: JsonRpcMessage) => ipcRenderer.invoke('proxy:write', { serverId, msg }),
  status: (serverId: string) => ipcRenderer.invoke('proxy:status', { serverId }),

  // ---------- sessions (M1) ----------
  sessionList: () => ipcRenderer.invoke('session:list') as Promise<SessionInfo[]>,
  sessionClose: (serverId: string) => ipcRenderer.invoke('session:close', { serverId }),

  // ---------- real MCP client (SDK, per session) ----------
  clientRequest: (serverId: string, method: string, params?: unknown) =>
    ipcRenderer.invoke('client:request', { serverId, method, params }),
  clientNotify: (serverId: string, method: string, params?: unknown) =>
    ipcRenderer.invoke('client:notify', { serverId, method, params }),
  clientStatus: (serverId: string) => ipcRenderer.invoke('client:status', { serverId }),
  /** Reset of the client connection: disconnect + reconnect (handshake). */
  clientRestart: (serverId: string) =>
    ipcRenderer.invoke('client:restart', { serverId }) as Promise<{ ok: boolean; error?: string }>,

  // ---------- session log ----------
  exportSession: (serverId: string) => ipcRenderer.invoke('session:export', { serverId }),
  importSession: (serverId: string) => ipcRenderer.invoke('session:import', { serverId }),

  // ---------- app ----------
  /** App version (package.json — semver MAJOR.MINOR.PATCH). */
  appVersion: () => ipcRenderer.invoke('app:getVersion') as Promise<string>,

  // ---------- servers/clients persistence ----------
  loadServers: () => ipcRenderer.invoke('servers:load') as Promise<SavedServer[]>,
  saveServers: (servers: SavedServer[]) => ipcRenderer.invoke('servers:save', servers) as Promise<{ ok: boolean }>,
  loadClients: () => ipcRenderer.invoke('clients:load') as Promise<SavedClient[]>,
  saveClients: (clients: SavedClient[]) => ipcRenderer.invoke('clients:save', clients) as Promise<{ ok: boolean }>,

  // ---------- interception (per session) ----------
  interceptList: (serverId: string) => ipcRenderer.invoke('intercept:list', { serverId }) as Promise<InterceptState>,
  interceptAddRule: (serverId: string, dir: 'c2s' | 's2c', method: string, simulation?: SimulationConfig) =>
    ipcRenderer.invoke('intercept:addRule', { serverId, dir, method, simulation }),
  interceptRemoveRule: (serverId: string, id: string) =>
    ipcRenderer.invoke('intercept:removeRule', { serverId, id }),
  interceptToggleRule: (serverId: string, id: string, enabled: boolean) =>
    ipcRenderer.invoke('intercept:toggleRule', { serverId, id, enabled }),
  interceptSetRuleSimulation: (serverId: string, id: string, simulation: SimulationConfig | null) =>
    ipcRenderer.invoke('intercept:setRuleSimulation', { serverId, id, simulation }),
  interceptSetInterceptAll: (serverId: string, dir: 'c2s' | 's2c', on: boolean) =>
    ipcRenderer.invoke('intercept:setInterceptAll', { serverId, dir, on }),
  interceptResolve: (serverId: string, id: string, resolution: HoldResolution) =>
    ipcRenderer.invoke('intercept:resolve', { serverId, id, resolution }),
  interceptClear: (serverId: string) => ipcRenderer.invoke('intercept:clear', { serverId }),
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard:write', { text }),
  specGet: () => ipcRenderer.invoke('spec:get'),
  specSet: (enabled: boolean) => ipcRenderer.invoke('spec:set', { enabled }),

  // ---------- push events ----------
  onEntry: (cb: (e: LogEntry) => void) => {
    const handler = (_: unknown, e: LogEntry) => cb(e);
    ipcRenderer.on('proxy:entry', handler);
    return () => ipcRenderer.removeListener('proxy:entry', handler);
  },
  onExit: (cb: (info: { serverId: string; code: number | null; signal: string | null }) => void) => {
    const handler = (_: unknown, info: { serverId: string; code: number | null; signal: string | null }) => cb(info);
    ipcRenderer.on('proxy:exit', handler);
    return () => ipcRenderer.removeListener('proxy:exit', handler);
  },
  onError: (cb: (info: { serverId?: string; message: string }) => void) => {
    const handler = (_: unknown, info: { serverId?: string; message: string }) => cb(info);
    ipcRenderer.on('proxy:error', handler);
    return () => ipcRenderer.removeListener('proxy:error', handler);
  },
  onSessionState: (cb: (sessions: SessionInfo[]) => void) => {
    const handler = (_: unknown, sessions: SessionInfo[]) => cb(sessions);
    ipcRenderer.on('session:state', handler);
    return () => ipcRenderer.removeListener('session:state', handler);
  },
  onClientConnected: (cb: (info: { serverId: string; serverName: string; serverVersion: string }) => void) => {
    const handler = (_: unknown, info: { serverId: string; serverName: string; serverVersion: string }) => cb(info);
    ipcRenderer.on('client:connected', handler);
    return () => ipcRenderer.removeListener('client:connected', handler);
  },
  onClientClosed: (cb: (info: { serverId: string }) => void) => {
    const handler = (_: unknown, info: { serverId: string }) => cb(info);
    ipcRenderer.on('client:closed', handler);
    return () => ipcRenderer.removeListener('client:closed', handler);
  },
  onClientError: (cb: (info: { serverId?: string; message: string }) => void) => {
    const handler = (_: unknown, info: { serverId?: string; message: string }) => cb(info);
    ipcRenderer.on('client:error', handler);
    return () => ipcRenderer.removeListener('client:error', handler);
  },
  onInterceptRules: (cb: (state: InterceptState) => void) => {
    const handler = (_: unknown, state: InterceptState) => cb(state);
    ipcRenderer.on('intercept:rules', handler);
    return () => ipcRenderer.removeListener('intercept:rules', handler);
  },
  onInterceptHeld: (cb: (held: HeldMessage) => void) => {
    const handler = (_: unknown, held: HeldMessage) => cb(held);
    ipcRenderer.on('intercept:held', handler);
    return () => ipcRenderer.removeListener('intercept:held', handler);
  },
  onInterceptReleased: (cb: (info: { serverId: string }) => void) => {
    const handler = (_: unknown, info: { serverId: string }) => cb(info);
    ipcRenderer.on('intercept:released', handler);
    return () => ipcRenderer.removeListener('intercept:released', handler);
  },
  onPausedChanged: (cb: (info: { serverId: string; paused: boolean }) => void) => {
    const handler = (_: unknown, info: { serverId: string; paused: boolean }) => cb(info);
    ipcRenderer.on('proxy:pausedChanged', handler);
    return () => ipcRenderer.removeListener('proxy:pausedChanged', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;