import React, { useEffect, useState, useCallback, useRef } from 'react';
import ServerPanel from './components/ServerPanel';
import ClientPanel from './components/ClientPanel';
import LogList from './components/LogList';
import { LogEntry, ServerConfig, JsonRpcMessage } from '../shared/types';

// Tipo del bridge expuesto por preload.ts via contextBridge.
declare global {
  interface Window {
    api: {
      start(c: ServerConfig): Promise<{ ok: boolean; running: boolean; error?: string }>;
      stop(): Promise<{ ok: boolean }>;
      write(m: JsonRpcMessage): Promise<{ ok: boolean }>;
      status(): Promise<{ running: boolean; count: number }>;
      clientRequest(method: string, params?: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }>;
      clientNotify(method: string, params?: unknown): Promise<{ ok: boolean; error?: string }>;
      clientStatus(): Promise<{ connected: boolean; server: { name?: string; version?: string; capabilities?: unknown } | null }>;
      exportSession(): Promise<{ ok: boolean; filePath?: string; error?: string }>;
      importSession(): Promise<{ ok: boolean; count?: number; error?: string }>;
      presets(): Promise<{ everything: ServerConfig }>;
      onEntry(cb: (e: LogEntry) => void): () => void;
      onExit(cb: (info: { code: number | null; signal: string | null }) => void): () => void;
      onError(cb: (info: { message: string }) => void): () => void;
      onClientConnected(cb: (info: { serverName: string; serverVersion: string }) => void): () => void;
      onClientClosed(cb: () => void): () => void;
      onClientError(cb: (info: { message: string }) => void): () => void;
    };
  }
}

/** Server MCP real: everything-server oficial (tools + resources + prompts). */
const DEFAULT_CONFIG: ServerConfig = {
  command: '',
  args: [],
};

export default function App(): React.ReactElement {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [clientConnected, setClientConnected] = useState(false);
  const [serverInfo, setServerInfo] = useState<{ name?: string; version?: string; capabilities?: unknown } | null>(null);
  const [lastToolResult, setLastToolResult] = useState<LogEntry | null>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: string | null } | null>(null);
  const [config, setConfig] = useState<ServerConfig>(DEFAULT_CONFIG);
  const [everythingPreset, setEverythingPreset] = useState<ServerConfig | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('Listo. Presiona Start para spawn del server + handshake del cliente.');

  // Cargar presets del main (paths absolutos a los servers de node_modules)
  useEffect(() => {
    void window.api.presets().then((p) => {
      if (p.everything.args[0]) {
        setEverythingPreset(p.everything);
        setConfig(p.everything);
      }
    });
  }, []);

  // Suscripciones a eventos IPC del main process
  useEffect(() => {
    const offEntry = window.api.onEntry((e) => setEntries((prev) => [...prev, e]));
    const offExit = window.api.onExit((info) => {
      setRunning(false);
      setClientConnected(false);
      setExitInfo(info);
      setStatusMsg(`Server exit code=${info.code} signal=${info.signal}`);
    });
    const offError = window.api.onError((info) => setStatusMsg(`ERROR: ${info.message}`));
    const offConn = window.api.onClientConnected((info) => {
      setClientConnected(true);
      setStatusMsg(`Cliente conectado a ${info.serverName} v${info.serverVersion} — handshake completo.`);
      // refrescar info del server (capabilities) desde el main
      void window.api.clientStatus().then((s) => setServerInfo(s.server));
    });
    const offClosed = window.api.onClientClosed(() => {
      setClientConnected(false);
      setStatusMsg('Cliente desconectado.');
    });
    const offCError = window.api.onClientError((info) => setStatusMsg(`CLIENT ERROR: ${info.message}`));
    return () => {
      offEntry(); offExit(); offError(); offConn(); offClosed(); offCError();
    };
  }, []);

  const onStart = useCallback(async () => {
    setEntries([]);
    setExitInfo(null);
    setLastToolResult(null);
    setStatusMsg('Spawn del server + handshake del cliente…');
    const r = await window.api.start(config);
    setRunning(r.running);
    if (!r.ok) {
      setStatusMsg(`Falló al iniciar: ${r.error ?? 'unknown'}`);
    }
  }, [config]);

  const onStop = useCallback(async () => {
    await window.api.stop();
  }, []);

  // Auto-start (una sola vez): con el preset real cargado, spawn del server
  // + handshake del cliente inmediato — la interacción se ve al abrir la app.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStarted.current && config.args.length > 0 && !running) {
      autoStarted.current = true;
      void onStart();
    }
  }, [config, running, onStart]);

  // ——— interacción cliente → server ———

  const doRequest = useCallback(async (method: string, params?: unknown, label?: string) => {
    setStatusMsg(`Enviando ${label ?? method}…`);
    const r = await window.api.clientRequest(method, params);
    if (r.ok) {
      setStatusMsg(`${label ?? method} OK — respuesta en el log.`);
      // mostrar result compacto en panel de cliente
      setLastToolResult({
        seq: -1, ts: new Date().toISOString(), dir: 's2c', kind: 'response',
        rpcId: null, method: label ?? method, result: r.result, raw: JSON.stringify(r.result),
      });
    } else {
      setStatusMsg(`ERROR en ${label ?? method}: ${r.error}`);
    }
  }, []);

  const onPing = useCallback(() => { void doRequest('ping', undefined, 'ping'); }, [doRequest]);
  const onListTools = useCallback(() => { void doRequest('tools/list', undefined, 'tools/list'); }, [doRequest]);
  const onCallEcho = useCallback(() => {
    void doRequest('tools/call', { name: 'echo', arguments: { message: 'hola desde el cliente MCP real' } }, 'tools/call echo');
  }, [doRequest]);
  const onCallLongRunning = useCallback(() => {
    void doRequest('tools/call', { name: 'longRunningOperation', arguments: { duration: 3, steps: 5 } }, 'tools/call longRunning');
  }, [doRequest]);

  const onSendRaw = useCallback(async (raw: string) => {
    try {
      const msg = JSON.parse(raw) as JsonRpcMessage;
      const r = await window.api.write(msg);
      setStatusMsg(r.ok ? 'Raw enviado (c2s en el log).' : 'Server no vivo — no se pudo enviar.');
    } catch {
      setStatusMsg('JSON inválido — no se envió.');
    }
  }, []);

  const onExport = useCallback(async () => {
    const r = await window.api.exportSession();
    setStatusMsg(r.ok ? `Exportado a ${r.filePath}` : `Export cancelado (${r.error})`);
  }, []);

  const onImport = useCallback(async () => {
    const r = await window.api.importSession();
    setStatusMsg(r.ok ? `Importado: ${r.count} entries` : `Import cancelado (${r.error})`);
    if (r.ok) {
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
          <span className={`pill ${clientConnected ? 'green' : 'gray'}`}>
            {clientConnected ? '● Cliente conectado' : '○ Cliente idle'}
          </span>
          <span className="pill">{entries.length} mensajes</span>
          {exitInfo && <span className="pill">exit code={exitInfo.code}</span>}
        </div>
      </header>
      <div className="middle">
        <ServerPanel
          config={config}
          onChange={setConfig}
          running={running}
          onStart={onStart}
          onStop={onStop}
          everythingPreset={everythingPreset}
        />
        <LogList entries={entries} />
        <ClientPanel
          clientConnected={clientConnected}
          serverInfo={serverInfo}
          lastToolResult={lastToolResult}
          onPing={onPing}
          onListTools={onListTools}
          onCallEcho={onCallEcho}
          onCallLongRunning={onCallLongRunning}
          onSendRaw={onSendRaw}
          onExport={onExport}
          onImport={onImport}
        />
      </div>
      <footer className="status">{statusMsg}</footer>
    </div>
  );
}