/**
 * Preload: expone IPC seguro al renderer.
 * contextIsolation: true → no podemos compartir variables, solo via window.api.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { LogEntry, ServerConfig, JsonRpcMessage } from '../shared/types';

const api = {
  start: (config: ServerConfig) => ipcRenderer.invoke('proxy:start', config),
  stop: () => ipcRenderer.invoke('proxy:stop'),
  write: (msg: JsonRpcMessage) => ipcRenderer.invoke('proxy:write', msg),
  status: () => ipcRenderer.invoke('proxy:status'),
  exportSession: () => ipcRenderer.invoke('session:export'),
  importSession: () => ipcRenderer.invoke('session:import'),

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
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
