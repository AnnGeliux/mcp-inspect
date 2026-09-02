import React, { useEffect, useState, useCallback, useRef } from 'react';
import ServerPanel from './components/ServerPanel';
import ClientPanel from './components/ClientPanel';
import LogList from './components/LogList';
import Wizard from './components/Wizard';
import InterceptBar from './components/InterceptBar';
import {
  LogEntry,
  ServerConfig,
  ClientConfig,
  JsonRpcMessage,
  SavedServer,
  SavedClient,
  InterceptRule,
  HeldMessage,
  HoldResolution,
  SimulationConfig,
} from '../shared/types';

// Type of the bridge exposed by preload.ts via contextBridge.
declare global {
  interface Window {
    api: {
      start(c: ServerConfig): Promise<{ ok: boolean; running: boolean; error?: string }>;
      stop(): Promise<{ ok: boolean }>;
      restart(): Promise<{ ok: boolean; running?: boolean; error?: string }>;
      killServer(): Promise<{ ok: boolean }>;
      pauseServer(): Promise<{ ok: boolean; paused: boolean }>;
      resumeServer(): Promise<{ ok: boolean; paused: boolean }>;
      write(m: JsonRpcMessage): Promise<{ ok: boolean }>;
      status(): Promise<{ running: boolean; count: number }>;
      clientRequest(method: string, params?: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }>;
      clientNotify(method: string, params?: unknown): Promise<{ ok: boolean; error?: string }>;
      clientStatus(): Promise<{ connected: boolean; server: { name?: string; version?: string; capabilities?: unknown } | null }>;
      clientRestart(): Promise<{ ok: boolean; error?: string }>;
      appVersion(): Promise<string>;
      exportSession(): Promise<{ ok: boolean; filePath?: string; error?: string }>;
      importSession(): Promise<{ ok: boolean; count?: number; error?: string }>;
      loadServers(): Promise<SavedServer[]>;
      saveServers(servers: SavedServer[]): Promise<{ ok: boolean }>;
      loadClients(): Promise<SavedClient[]>;
      saveClients(clients: SavedClient[]): Promise<{ ok: boolean }>;
      interceptList(): Promise<{ rules: InterceptRule[]; interceptAllC2s: boolean; interceptAllS2c: boolean; held: HeldMessage[]; paused?: boolean; queue?: { c2s: number; s2c: number } }>;
      interceptAddRule(dir: 'c2s' | 's2c', method: string, simulation?: SimulationConfig): Promise<{ ok: boolean; rule?: InterceptRule }>;
      interceptRemoveRule(id: string): Promise<{ ok: boolean }>;
      interceptToggleRule(id: string, enabled: boolean): Promise<{ ok: boolean }>;
      interceptSetInterceptAll(dir: 'c2s' | 's2c', on: boolean): Promise<{ ok: boolean }>;
      interceptResolve(id: string, resolution: HoldResolution): Promise<{ ok: boolean }>;
      interceptClear(): Promise<{ ok: boolean }>;
      clipboardWrite(text: string): Promise<{ ok: boolean }>;
      specGet(): Promise<{ enabled: boolean }>;
      specSet(enabled: boolean): Promise<{ ok: boolean }>;
      onEntry(cb: (e: LogEntry) => void): () => void;
      onExit(cb: (info: { code: number | null; signal: string | null }) => void): () => void;
      onError(cb: (info: { message: string }) => void): () => void;
      onClientConnected(cb: (info: { serverName: string; serverVersion: string }) => void): () => void;
      onClientClosed(cb: () => void): () => void;
      onClientError(cb: (info: { message: string }) => void): () => void;
      onInterceptRules(cb: (state: { rules: InterceptRule[]; interceptAllC2s: boolean; interceptAllS2c: boolean; held: HeldMessage[]; paused?: boolean; queue?: { c2s: number; s2c: number } }) => void): () => void;
      onInterceptHeld(cb: (held: HeldMessage) => void): () => void;
      onInterceptReleased(cb: () => void): () => void;
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
  const [statusMsg, setStatusMsg] = useState<string>('Ready. Select a server and a client to start.');
  // App version (semver MAJOR.MINOR.PATCH — package.json)
  const [appVersion, setAppVersion] = useState<string>('');

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

  // ——— Intercept state (Phase 6) ———
  const [interceptRules, setInterceptRules] = useState<InterceptRule[]>([]);
  const [interceptAllC2s, setInterceptAllC2sState] = useState(false);
  const [interceptAllS2c, setInterceptAllS2cState] = useState(false);
  const [heldMessages, setHeldMessages] = useState<HeldMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [pausedQueue, setPausedQueue] = useState<{ c2s: number; s2c: number }>({ c2s: 0, s2c: 0 });

  // Editable config of the selected server
  const [config, setConfig] = useState<ServerConfig>({ command: '', args: [] });

  const hasSelection = selectedServerId !== null && selectedClientId !== null;
  const autoStarted = useRef(false);

  // ——— Load persisted servers/clients on mount ———
  useEffect(() => {
    void (async () => {
      const [loadedServers, loadedClients, version] = await Promise.all([
        window.api.loadServers(),
        window.api.loadClients(),
        window.api.appVersion(),
      ]);
      setServers(loadedServers);
      setClients(loadedClients);
      setAppVersion(version);
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
      setPaused(false);
      setStatusMsg(`Server exit code=${info.code} signal=${info.signal}`);
    });
    const offError = window.api.onError((info) => setStatusMsg(`ERROR: ${info.message}`));
    const offConn = window.api.onClientConnected((info) => {
      setClientConnected(true);
      setStatusMsg(`Client connected to ${info.serverName} v${info.serverVersion} — handshake complete.`);
      void window.api.clientStatus().then((s) => setServerInfo(s.server));
    });
    const offClosed = window.api.onClientClosed(() => {
      setClientConnected(false);
      setStatusMsg('Client disconnected.');
    });
    const offCError = window.api.onClientError((info) => setStatusMsg(`CLIENT ERROR: ${info.message}`));
    const offIRules = window.api.onInterceptRules((state) => {
      setInterceptRules(state.rules);
      setInterceptAllC2sState(state.interceptAllC2s);
      setInterceptAllS2cState(state.interceptAllS2c);
      setHeldMessages(state.held);
      if (state.paused !== undefined) setPaused(state.paused);
      if (state.queue !== undefined) setPausedQueue(state.queue);
    });
    const offIHeld = window.api.onInterceptHeld(() => {
      void window.api.interceptList().then((s) => {
        setInterceptRules(s.rules);
        setInterceptAllC2sState(s.interceptAllC2s);
        setInterceptAllS2cState(s.interceptAllS2c);
        setHeldMessages(s.held);
      });
    });
    const offIReleased = window.api.onInterceptReleased(() => {
      void window.api.interceptList().then((s) => {
        setInterceptRules(s.rules);
        setInterceptAllC2sState(s.interceptAllC2s);
        setInterceptAllS2cState(s.interceptAllS2c);
        setHeldMessages(s.held);
      });
    });
    return () => {
      offEntry(); offExit(); offError(); offConn(); offClosed(); offCError();
      offIRules(); offIHeld(); offIReleased();
    };
  }, []);

  // Fetch intercept state on mount
  useEffect(() => {
    void window.api.interceptList().then((s) => {
      setInterceptRules(s.rules);
      setInterceptAllC2sState(s.interceptAllC2s);
      setInterceptAllS2cState(s.interceptAllS2c);
      setHeldMessages(s.held);
    });
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

  const handleAddServer = useCallback((name: string, newConfig: ServerConfig, description?: string) => {
    const id = `server-${Date.now()}`;
    const newServer: SavedServer = { id, name, description, config: newConfig };
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

  const handleUpdateServer = useCallback((id: string, name: string, newConfig: ServerConfig, description?: string) => {
    setServers((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, name, description, config: newConfig } : s,
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

  const handleAddClient = useCallback((name: string, clientConfig: ClientConfig, description?: string) => {
    const id = `client-${Date.now()}`;
    const newClient: SavedClient = { id, name, description, config: clientConfig };
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

  const handleUpdateClient = useCallback((id: string, name: string, clientConfig: ClientConfig, description?: string) => {
    setClients((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, name, description, config: clientConfig } : c,
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
    setStatusMsg('Spawning server + client handshake…');
    const r = await window.api.start(config);
    setRunning(r.running);
    if (!r.ok) {
      setStatusMsg(`Failed to start: ${r.error ?? 'unknown'}`);
    }
  }, [config]);

  // Restart the subprocess with the same config (Phase 5)
  const onRestart = useCallback(async () => {
    setStatusMsg('Restarting server…');
    const r = await window.api.restart();
    if (r.ok) {
      setRunning(r.running ?? true);
      setStatusMsg('Server restarted — session preserved.');
    } else {
      setStatusMsg(`Restart failed: ${r.error ?? 'unknown'}`);
    }
  }, []);

  // Reset the MCP client: disconnect + reconnect (fresh handshake), without touching the server
  const onClientRestart = useCallback(async () => {
    setStatusMsg('Reconnecting client…');
    const r = await window.api.clientRestart();
    setStatusMsg(r.ok ? 'Client reconnected — handshake complete.' : `Reconnect failed: ${r.error ?? 'unknown'}`);
  }, []);

  // Kill the subprocess immediately (Phase 5)
  const onKill = useCallback(async () => {
    await window.api.killServer();
    setStatusMsg('Server killed (SIGKILL).');
  }, []);

  // MITM pause: freeze ALL traffic without killing the subprocess (Phase 6)
  const onPause = useCallback(async () => {
    const r = await window.api.pauseServer();
    if (r.ok) {
      setPaused(true);
      setStatusMsg('Traffic paused — the server stays alive.');
    }
  }, []);

  // Resume: release the FIFO queue (messages re-enter the pipeline)
  const onResume = useCallback(async () => {
    const r = await window.api.resumeServer();
    if (r.ok) {
      setPaused(false);
      setStatusMsg('Traffic resumed — the queue was released in order.');
    }
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
    setStatusMsg(`Sending ${label ?? method}…`);
    const r = await window.api.clientRequest(method, params);
    if (r.ok) {
      setStatusMsg(`${label ?? method} OK — response in the log.`);
      setLastToolResult({
        seq: -1, ts: new Date().toISOString(), dir: 's2c', kind: 'response',
        rpcId: null, method: label ?? method, result: r.result, raw: JSON.stringify(r.result),
      });
    } else {
      setStatusMsg(`ERROR in ${label ?? method}: ${r.error}`);
    }
  }, []);

  const onPing = useCallback(() => { void doRequest('ping', undefined, 'ping'); }, [doRequest]);
  const onListTools = useCallback(() => { void doRequest('tools/list', undefined, 'tools/list'); }, [doRequest]);
  const onCallEcho = useCallback(() => {
    void doRequest('tools/call', { name: 'echo', arguments: { message: 'hello from the real MCP client' } }, 'tools/call echo');
  }, [doRequest]);
  const onCallLongRunning = useCallback(() => {
    void doRequest('tools/call', { name: 'longRunningOperation', arguments: { duration: 3, steps: 5 } }, 'tools/call longRunning');
  }, [doRequest]);

  const onSendRaw = useCallback(async (raw: string) => {
    try {
      const msg = JSON.parse(raw) as JsonRpcMessage;
      const r = await window.api.write(msg);
      setStatusMsg(r.ok ? 'Raw sent (c2s in the log).' : 'Server not alive — could not send.');
    } catch {
      setStatusMsg('Invalid JSON — not sent.');
    }
  }, []);

  const onExport = useCallback(async () => {
    const r = await window.api.exportSession();
    setStatusMsg(r.ok ? `Exported to ${r.filePath}` : `Export canceled (${r.error})`);
  }, []);

  const onImport = useCallback(async () => {
    const r = await window.api.importSession();
    setStatusMsg(r.ok ? `Imported: ${r.count} entries` : `Import canceled (${r.error})`);
    if (r.ok) {
      const s = await window.api.status();
      setEntries((prev) => prev.slice(0, s.count));
    }
  }, []);

  // ——— Intercept handlers (Phase 6+7) ———
  const handleAddRule = useCallback((dir: 'c2s' | 's2c', method: string, simulation?: SimulationConfig) => {
    void window.api.interceptAddRule(dir, method, simulation);
  }, []);

  const handleRemoveRule = useCallback((id: string) => {
    void window.api.interceptRemoveRule(id);
  }, []);

  const handleToggleRule = useCallback((id: string, enabled: boolean) => {
    void window.api.interceptToggleRule(id, enabled);
  }, []);

  const handleSetInterceptAll = useCallback((dir: 'c2s' | 's2c', on: boolean) => {
    void window.api.interceptSetInterceptAll(dir, on);
  }, []);

  const handleInterceptClear = useCallback(async () => {
    await window.api.interceptClear();
    const s = await window.api.interceptList();
    setInterceptRules(s.rules);
    setInterceptAllC2sState(s.interceptAllC2s);
    setInterceptAllS2cState(s.interceptAllS2c);
    setHeldMessages(s.held);
  }, []);

  const handleResolveHold = useCallback(async (id: string, resolution: HoldResolution) => {
    const r = await window.api.interceptResolve(id, resolution);
    if (!r.ok) setStatusMsg('The hold was already resolved or does not exist.');
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

  // Don't render main UI until initialized
  if (!initialized) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand"><div className="logo">⌘</div> MCP Inspector{appVersion && <span className="brand-version" title="App version">v{appVersion}</span>}</div>
        </header>
        <div className="middle" style={{ display: 'grid', placeItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)' }}>Loading…</span>
        </div>
      </div>
    );
  }

  // Show wizard when no selection and wizard is active
  if (showWizard && !hasSelection) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand"><div className="logo">⌘</div> MCP Inspector{appVersion && <span className="brand-version" title="App version">v{appVersion}</span>}</div>
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
        <div className="brand"><div className="logo">⌘</div> MCP Inspector{appVersion && <span className="brand-version" title="App version">v{appVersion}</span>}</div>
        <div className="session-info">
          <span className={`pill ${running ? 'green' : 'gray'}`}>{running ? '● Capturing' : '○ Stopped'}</span>
          {paused && <span className="pill warning" title="Traffic frozen — the subprocess stays alive">⏸ Paused</span>}
          {paused && (pausedQueue.c2s + pausedQueue.s2c) > 0 && (
            <span className="pill warning" title="Messages queued waiting for resume">{
              `${pausedQueue.c2s + pausedQueue.s2c} queued (→${pausedQueue.c2s} ←${pausedQueue.s2c})`
            }</span>
          )}
          <span className="pill">{entries.length} messages</span>
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
          onRestart={onRestart}
          onKill={onKill}
          paused={paused}
          onPause={onPause}
          onResume={onResume}
        />
        <div className="center-col">
          <InterceptBar
            rules={interceptRules}
            interceptAllC2s={interceptAllC2s}
            interceptAllS2c={interceptAllS2c}
            held={heldMessages}
            onAddRule={handleAddRule}
            onRemoveRule={handleRemoveRule}
            onToggleRule={handleToggleRule}
            onSetInterceptAll={handleSetInterceptAll}
            onClearAll={handleInterceptClear}
            onResolve={handleResolveHold}
          />
          <LogList entries={entries} />
        </div>
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
          onClientRestart={onClientRestart}
          onExport={onExport}
          onImport={onImport}
        />
      </div>
      <footer className="status">
        <div className="status-left">{statusMsg}</div>
      </footer>
    </div>
  );
}