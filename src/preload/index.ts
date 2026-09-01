/**
 * Preload: expone IPC seguro al renderer.
 * contextIsolation: true -> no podemos compartir variables, solo via window.api.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  LogEntry,
  ServerConfig,
  JsonRpcMessage,
  SavedServer,
  SavedClient,
  InterceptRule,
  HeldMessage,
  HoldResolution,
  SimulationConfig,
} from '../shared/types';

const api = {
  // ---------- proxy (server subprocess) ----------
  start: (config: ServerConfig) => ipcRenderer.invoke('proxy:start', config),
  stop: () => ipcRenderer.invoke('proxy:stop'),
  restart: () => ipcRenderer.invoke('proxy:restart'),
  killServer: () => ipcRenderer.invoke('proxy:kill'),
  pauseServer: () => ipcRenderer.invoke('proxy:pause'),
  resumeServer: () => ipcRenderer.invoke('proxy:resume'),
  write: (msg: JsonRpcMessage) => ipcRenderer.invoke('proxy:write', msg),
  status: () => ipcRenderer.invoke('proxy:status'),

  // ---------- cliente MCP real (SDK) ----------
  clientRequest: (method: string, params?: unknown) =>
    ipcRenderer.invoke('client:request', { method, params }),
  clientNotify: (method: string, params?: unknown) =>
    ipcRenderer.invoke('client:notify', { method, params }),
  clientStatus: () => ipcRenderer.invoke('client:status'),

  // ---------- sesion ----------
  exportSession: () => ipcRenderer.invoke('session:export'),
  importSession: () => ipcRenderer.invoke('session:import'),

  // ---------- persistencia de servers/clients ----------
  loadServers: () => ipcRenderer.invoke('servers:load') as Promise<SavedServer[]>,
  saveServers: (servers: SavedServer[]) => ipcRenderer.invoke('servers:save', servers) as Promise<{ ok: boolean }>,
  loadClients: () => ipcRenderer.invoke('clients:load') as Promise<SavedClient[]>,
  saveClients: (clients: SavedClient[]) => ipcRenderer.invoke('clients:save', clients) as Promise<{ ok: boolean }>,

  // ---------- interceptacion ----------
  interceptList: () =>
    ipcRenderer.invoke('intercept:list') as Promise<{
      rules: InterceptRule[];
      interceptAllC2s: boolean;
      interceptAllS2c: boolean;
      held: HeldMessage[];
      paused?: boolean;
      queue?: { c2s: number; s2c: number };
    }>,
  interceptAddRule: (dir: 'c2s' | 's2c', method: string, simulation?: SimulationConfig) =>
    ipcRenderer.invoke('intercept:addRule', { dir, method, simulation }),
  interceptRemoveRule: (id: string) =>
    ipcRenderer.invoke('intercept:removeRule', { id }),
  interceptToggleRule: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('intercept:toggleRule', { id, enabled }),
  interceptSetRuleSimulation: (id: string, simulation: SimulationConfig | null) =>
    ipcRenderer.invoke('intercept:setRuleSimulation', { id, simulation }),
  interceptSetInterceptAll: (dir: 'c2s' | 's2c', on: boolean) =>
    ipcRenderer.invoke('intercept:setInterceptAll', { dir, on }),
  interceptResolve: (id: string, resolution: HoldResolution) =>
    ipcRenderer.invoke('intercept:resolve', { id, resolution }),
  interceptClear: () => ipcRenderer.invoke('intercept:clear'),
  clipboardWrite: (text: string) => ipcRenderer.invoke('clipboard:write', { text }),
  specGet: () => ipcRenderer.invoke('spec:get'),
  specSet: (enabled: boolean) => ipcRenderer.invoke('spec:set', { enabled }),

  // ---------- eventos push ----------
  onEntry: (cb: (e: LogEntry) => void) => {
    const handler = (_: unknown, e: LogEntry) => cb(e);
    ipcRenderer.on('proxy:entry', handler);
    return () => ipcRenderer.removeListener('proxy:entry', handler);
  },
  onExit: (cb: (info: { code: number | null; signal: string | null }) => void) => {
    const handler = (_: unknown, info: { code: number | null; signal: string | null }) => cb(info);
    ipcRenderer.on('proxy:exit', handler);
    return () => ipcRenderer.removeListener('proxy:exit', handler);
  },
  onError: (cb: (info: { message: string }) => void) => {
    const handler = (_: unknown, info: { message: string }) => cb(info);
    ipcRenderer.on('proxy:error', handler);
    return () => ipcRenderer.removeListener('proxy:error', handler);
  },
  onClientConnected: (cb: (info: { serverName: string; serverVersion: string }) => void) => {
    const handler = (_: unknown, info: { serverName: string; serverVersion: string }) => cb(info);
    ipcRenderer.on('client:connected', handler);
    return () => ipcRenderer.removeListener('client:connected', handler);
  },
  onClientClosed: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('client:closed', handler);
    return () => ipcRenderer.removeListener('client:closed', handler);
  },
  onClientError: (cb: (info: { message: string }) => void) => {
    const handler = (_: unknown, info: { message: string }) => cb(info);
    ipcRenderer.on('client:error', handler);
    return () => ipcRenderer.removeListener('client:error', handler);
  },
  onInterceptRules: (
    cb: (state: {
      rules: InterceptRule[];
      interceptAllC2s: boolean;
      interceptAllS2c: boolean;
      held: HeldMessage[];
      paused?: boolean;
      queue?: { c2s: number; s2c: number };
    }) => void,
  ) => {
    const handler = (
      _: unknown,
      state: {
        rules: InterceptRule[];
        interceptAllC2s: boolean;
        interceptAllS2c: boolean;
        held: HeldMessage[];
        paused?: boolean;
        queue?: { c2s: number; s2c: number };
      },
    ) => cb(state);
    ipcRenderer.on('intercept:rules', handler);
    return () => ipcRenderer.removeListener('intercept:rules', handler);
  },
  onInterceptHeld: (cb: (held: HeldMessage) => void) => {
    const handler = (_: unknown, held: HeldMessage) => cb(held);
    ipcRenderer.on('intercept:held', handler);
    return () => ipcRenderer.removeListener('intercept:held', handler);
  },
  onInterceptReleased: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('intercept:released', handler);
    return () => ipcRenderer.removeListener('intercept:released', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;