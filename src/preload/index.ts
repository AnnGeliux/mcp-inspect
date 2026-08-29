/**
 * Preload: expone IPC seguro al renderer.
 * contextIsolation: true → no podemos compartir variables, solo via window.api.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { LogEntry, ServerConfig, JsonRpcMessage, SavedServer, SavedClient } from '../shared/types';

const api = {
  // ——— proxy (server subprocess) ———
  start: (config: ServerConfig) => ipcRenderer.invoke('proxy:start', config),
  stop: () => ipcRenderer.invoke('proxy:stop'),
  write: (msg: JsonRpcMessage) => ipcRenderer.invoke('proxy:write', msg),
  status: () => ipcRenderer.invoke('proxy:status'),

  // ——— cliente MCP real (SDK) ———
  clientRequest: (method: string, params?: unknown) =>
    ipcRenderer.invoke('client:request', { method, params }),
  clientNotify: (method: string, params?: unknown) =>
    ipcRenderer.invoke('client:notify', { method, params }),
  clientStatus: () => ipcRenderer.invoke('client:status'),

  // ——— sesión ———
  exportSession: () => ipcRenderer.invoke('session:export'),
  importSession: () => ipcRenderer.invoke('session:import'),

  // ——— persistencia de servers/clients ———
  loadServers: () => ipcRenderer.invoke('servers:load') as Promise<SavedServer[]>,
  saveServers: (servers: SavedServer[]) => ipcRenderer.invoke('servers:save', servers) as Promise<{ ok: boolean }>,
  loadClients: () => ipcRenderer.invoke('clients:load') as Promise<SavedClient[]>,
  saveClients: (clients: SavedClient[]) => ipcRenderer.invoke('clients:save', clients) as Promise<{ ok: boolean }>,

  // ——— eventos push ———
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
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;