import React, { useEffect, useState, useCallback } from 'react';
import ServerPanel from './components/ServerPanel';
import ClientPanel from './components/ClientPanel';
import LogList from './components/LogList';
import { LogEntry, ServerConfig, JsonRpcMessage } from '../shared/types';

// Tipo del bridge expuesto por preload.ts via contextBridge.
declare global {
  interface Window {
    api: {
      start(c: ServerConfig): Promise<{ ok: boolean; running: boolean }>;
      stop(): Promise<{ ok: boolean }>;
      write(m: JsonRpcMessage): Promise<{ ok: boolean }>;
      status(): Promise<{ running: boolean; count: number }>;
      exportSession(): Promise<{ ok: boolean; filePath?: string; error?: string }>;
      importSession(): Promise<{ ok: boolean; count?: number; error?: string }>;
      onEntry(cb: (e: LogEntry) => void): () => void;
      onExit(cb: (info: { code: number | null; signal: string | null }) => void): () => void;
      onError(cb: (info: { message: string }) => void): () => void;
    };
  }
}

const DEFAULT_CONFIG: ServerConfig = {
  command: 'node',
  args: ['-e', "console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}}))"],
};

export default function App(): React.ReactElement {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: string | null } | null>(null);
  const [config, setConfig] = useState<ServerConfig>(DEFAULT_CONFIG);
  const [statusMsg, setStatusMsg] = useState<string>('Listo. Configura el server y presiona Start.');

  // Suscripciones a eventos IPC del main process
  useEffect(() => {
    const offEntry = window.api.onEntry((e) => setEntries((prev) => [...prev, e]));
    const offExit = window.api.onExit((info) => {
      setRunning(false);
      setExitInfo(info);
      setStatusMsg(`Exit code=${info.code} signal=${info.signal}`);
    });
    const offError = window.api.onError((info) => setStatusMsg(`ERROR: ${info.message}`));
    return () => { offEntry(); offExit(); offError(); };
  }, []);

  const onStart = useCallback(async () => {
    setEntries([]);
    setExitInfo(null);
    setStatusMsg('Iniciando subprocess…');
    const r = await window.api.start(config);
    setRunning(r.running);
    setStatusMsg(r.running ? 'Capturando tráfico.' : 'Falló al iniciar.');
  }, [config]);

  const onStop = useCallback(async () => {
    await window.api.stop();
  }, []);

  const onSendPing = useCallback(async () => {
    await window.api.write({ jsonrpc: '2.0', id: 99, method: 'ping' });
  }, []);

  const onExport = useCallback(async () => {
    const r = await window.api.exportSession();
    setStatusMsg(r.ok ? `Exportado a ${r.filePath}` : `Export cancelado (${r.error})`);
  }, []);

  const onImport = useCallback(async () => {
    const r = await window.api.importSession();
    setStatusMsg(r.ok ? `Importado: ${r.count} entries` : `Import cancelado (${r.error})`);
    if (r.ok) {
      // Re-leer status para refrescar entries
      const s = await window.api.status();
      setEntries((prev) => prev.slice(0, s.count));
    }
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><div className="logo">⌘</div> MCP Inspector</div>
        <div className="session-info">
          <span className={`pill ${running ? 'green' : 'gray'}`}>{running ? '● Capturando' : '○ Detenido'}</span>
          <span className="pill">{entries.length} mensajes</span>
          {exitInfo && <span className="pill">exit code={exitInfo.code}</span>}
        </div>
      </header>
      <div className="middle">
        <ServerPanel config={config} onChange={setConfig} running={running} onStart={onStart} onStop={onStop} />
        <LogList entries={entries} />
        <ClientPanel onSendPing={onSendPing} onExport={onExport} onImport={onImport} />
      </div>
      <footer className="status">{statusMsg}</footer>
    </div>
  );
}
