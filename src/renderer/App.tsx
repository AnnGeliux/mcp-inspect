import React, { useEffect, useState, useCallback, useRef } from 'react';
import ServerPanel from './components/ServerPanel';
import ClientPanel from './components/ClientPanel';
import LogList from './components/LogList';
import Wizard from './components/Wizard';
import {
  LogEntry,
  ServerConfig,
  ClientConfig,
  JsonRpcMessage,
  SavedServer,
  SavedClient,
} from '../shared/types';

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
      loadServers(): Promise<SavedServer[]>;
      saveServers(servers: SavedServer[]): Promise<{ ok: boolean }>;
      loadClients(): Promise<SavedClient[]>;
      saveClients(clients: SavedClient[]): Promise<{ ok: boolean }>;
      onEntry(cb: (e: LogEntry) => void): () => void;
      onExit(cb: (info: { code: number | null; signal: string | null }) => void): () => void;
      onError(cb: (info: { message: string }) => void): () => void;
      onClientConnected(cb: (info: { serverName: string; serverVersion: string }) => void): () => void;
      onClientClosed(cb: () => void): () => void;
      onClientError(cb: (info: { message: string }) => void): () => void;
    };
  }
}

export default function App(): React.ReactElement {
  // ——— Traffic / session state ———
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [clientConnected, setClientConnected] = useState(false);
  const [serverInfo, setServerInfo] = useState<{ name?: string; version?: string; capabilities?: unknown } | null>(null);
  const [lastToolResult, setLastToolResult] = useState<LogEntry | null>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: string | null } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('Listo. Selecciona un server y un client.');

  // ——— Persisted servers/clients ———
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [clients, setClients] = useState<SavedClient[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  // ——— Wizard state ———
  // Only show wizard when both are null AND it's the initial load (no prior selection)
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [showWizard, setShowWizard] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Config editable del server seleccionado
  const [config, setConfig] = useState<ServerConfig>({ command: '', args: [] });

  const hasSelection = selectedServerId !== null && selectedClientId !== null;
  const autoStarted = useRef(false);

  // ——— Load persisted servers/clients on mount ———
  useEffect(() => {
    void (async () => {
      const [loadedServers, loadedClients] = await Promise.all([
        window.api.loadServers(),
        window.api.loadClients(),
      ]);
      setServers(loadedServers);
      setClients(loadedClients);
      // Auto-select first server and first client if available
      if (loadedServers.length > 0) {
        setSelectedServerId(loadedServers[0]!.id);
        setConfig(loadedServers[0]!.config);
      }
      if (loadedClients.length > 0) {
        setSelectedClientId(loadedClients[0]!.id);
      }
      // Show wizard only if nothing is pre-selected
      if (loadedServers.length === 0 && loadedClients.length === 0) {
        setShowWizard(true);
      }
      setInitialized(true);
    })();
  }, []);

  // ——— IPC event subscriptions ———
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

  // ——— Server CRUD ———
  const handleSelectServer = useCallback((id: string) => {
    const s = servers.find((srv) => srv.id === id);
    if (s) {
      setSelectedServerId(id);
      setConfig(s.config);
      autoStarted.current = false;
      // If wizard is showing and we're on step 1, advance to step 2
      if (showWizard && wizardStep === 1) {
        setWizardStep(2);
      }
    }
  }, [servers, showWizard, wizardStep]);

  const handleAddServer = useCallback((name: string, newConfig: ServerConfig) => {
    const id = `server-${Date.now()}`;
    const newServer: SavedServer = { id, name, config: newConfig };
    setServers((prev) => {
      const updated = [...prev, newServer];
      void window.api.saveServers(updated);
      return updated;
    });
    setSelectedServerId(id);
    setConfig(newConfig);
    // In wizard, advance after adding
    if (showWizard && wizardStep === 1) {
      setWizardStep(2);
    }
  }, [showWizard, wizardStep]);

  const handleUpdateServer = useCallback((id: string, name: string, newConfig: ServerConfig) => {
    setServers((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, name, config: newConfig } : s,
      );
      void window.api.saveServers(updated);
      return updated;
    });
    if (selectedServerId === id) {
      setConfig(newConfig);
    }
  }, [selectedServerId]);

  const handleDeleteServer = useCallback((id: string) => {
    setServers((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      void window.api.saveServers(updated);
      return updated;
    });
    if (selectedServerId === id) {
      setSelectedServerId(null);
      setConfig({ command: '', args: [] });
    }
  }, [selectedServerId]);

  // ——— Client CRUD ———
  const handleSelectClient = useCallback((id: string) => {
    setSelectedClientId(id);
    autoStarted.current = false;
    // In wizard, selecting a client finishes the wizard
    if (showWizard) {
      setShowWizard(false);
    }
  }, [showWizard]);

  const handleAddClient = useCallback((name: string, clientConfig: ClientConfig) => {
    const id = `client-${Date.now()}`;
    const newClient: SavedClient = { id, name, config: clientConfig };
    setClients((prev) => {
      const updated = [...prev, newClient];
      void window.api.saveClients(updated);
      return updated;
    });
    setSelectedClientId(id);
    if (showWizard) {
      setShowWizard(false);
    }
  }, [showWizard]);

  const handleUpdateClient = useCallback((id: string, name: string, clientConfig: ClientConfig) => {
    setClients((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, name, config: clientConfig } : c,
      );
      void window.api.saveClients(updated);
      return updated;
    });
  }, []);

  const handleDeleteClient = useCallback((id: string) => {
    setClients((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      void window.api.saveClients(updated);
      return updated;
    });
    if (selectedClientId === id) {
      setSelectedClientId(id === selectedClientId ? null : selectedClientId);
    }
  }, [selectedClientId]);

  // ——— Start / Stop ———
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

  // Auto-start when both server + client are selected (once)
  useEffect(() => {
    if (
      !autoStarted.current &&
      hasSelection &&
      config.args.length > 0 &&
      !running
    ) {
      autoStarted.current = true;
      void onStart();
    }
  }, [hasSelection, config, running, onStart]);

  // ——— Client → server interaction ———
  const doRequest = useCallback(async (method: string, params?: unknown, label?: string) => {
    setStatusMsg(`Enviando ${label ?? method}…`);
    const r = await window.api.clientRequest(method, params);
    if (r.ok) {
      setStatusMsg(`${label ?? method} OK — respuesta en el log.`);
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

  // ——— Wizard handlers ———
  const handleWizardAdvance = useCallback(() => {
    if (wizardStep === 1) {
      setWizardStep(2);
    } else {
      setShowWizard(false);
    }
  }, [wizardStep]);

  const handleWizardBack = useCallback(() => {
    if (wizardStep === 2) setWizardStep(1);
  }, [wizardStep]);

  const handleChangeServer = useCallback(() => {
    setWizardStep(1);
    setShowWizard(true);
  }, []);

  const handleChangeClient = useCallback(() => {
    setWizardStep(2);
    setShowWizard(true);
  }, []);

  // Don't render main UI until initialized
  if (!initialized) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand"><div className="logo">⌘</div> MCP Inspector</div>
        </header>
        <div className="middle" style={{ display: 'grid', placeItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)' }}>Cargando…</span>
        </div>
      </div>
    );
  }

  // Show wizard when no selection and wizard is active
  if (showWizard && !hasSelection) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand"><div className="logo">⌘</div> MCP Inspector</div>
          <div className="session-info">
            <span className="pill gray">○ Wizard</span>
          </div>
        </header>
        <Wizard
          step={wizardStep}
          servers={servers}
          clients={clients}
          selectedServerId={selectedServerId}
          selectedClientId={selectedClientId}
          running={running}
          clientConnected={clientConnected}
          onSelectServer={handleSelectServer}
          onSelectClient={handleSelectClient}
          onAddServer={handleAddServer}
          onAddClient={handleAddClient}
          onAdvance={handleWizardAdvance}
          onBack={handleWizardBack}
        />
        <footer className="status">{statusMsg}</footer>
      </div>
    );
  }

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
          servers={servers}
          selectedId={selectedServerId}
          config={config}
          onSelect={handleSelectServer}
          onChange={setConfig}
          onAdd={handleAddServer}
          onUpdate={handleUpdateServer}
          onDelete={handleDeleteServer}
          running={running}
          onStart={onStart}
          onStop={onStop}
        />
        <LogList entries={entries} />
        <ClientPanel
          clients={clients}
          selectedClientId={selectedClientId}
          onSelectClient={handleSelectClient}
          onAddClient={handleAddClient}
          onUpdateClient={handleUpdateClient}
          onDeleteClient={handleDeleteClient}
          clientConnected={clientConnected}
          serverInfo={serverInfo}
          lastToolResult={lastToolResult}
          hasSelection={hasSelection}
          onPing={onPing}
          onListTools={onListTools}
          onCallEcho={onCallEcho}
          onCallLongRunning={onCallLongRunning}
          onSendRaw={onSendRaw}
          onExport={onExport}
          onImport={onImport}
        />
      </div>
      <footer className="status">
        <div className="status-left">{statusMsg}</div>
        <div className="status-right">
          <button className="btn-link" onClick={handleChangeServer} title="Cambiar MCP Server">↻ Server</button>
          <button className="btn-link" onClick={handleChangeClient} title="Cambiar MCP Client">↻ Client</button>
        </div>
      </footer>
    </div>
  );
}