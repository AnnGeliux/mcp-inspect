import React, { useEffect, useState, useCallback, useRef } from 'react';
import ServerPanel from './components/ServerPanel';
import ClientPanel from './components/ClientPanel';
import LogList from './components/LogList';
import Wizard from './components/Wizard';
import InterceptBar from './components/InterceptBar';
import SessionTabs from './components/SessionTabs';
import {
  LogEntry,
  ServerConfig,
  ClientConfig,
  SessionInfo,
  JsonRpcMessage,
  SavedServer,
  SavedClient,
  InterceptRule,
  HeldMessage,
  HoldResolution,
  SimulationConfig,
} from '../shared/types';

/** Intercept state of one session (mirrors the preload shape). */
interface InterceptState {
  serverId: string;
  rules: InterceptRule[];
  interceptAllC2s: boolean;
  interceptAllS2c: boolean;
  held: HeldMessage[];
  paused?: boolean;
  queue?: { c2s: number; s2c: number };
}

// Type of the bridge exposed by preload.ts via contextBridge.
declare global {
  interface Window {
    api: {
      start(serverId: string, name: string, c: ServerConfig): Promise<{ ok: boolean; running: boolean; error?: string }>;
      stop(serverId: string): Promise<{ ok: boolean; error?: string }>;
      restart(serverId: string): Promise<{ ok: boolean; running?: boolean; error?: string }>;
      killServer(serverId: string): Promise<{ ok: boolean; error?: string }>;
      pauseServer(serverId: string): Promise<{ ok: boolean; paused: boolean; error?: string }>;
      resumeServer(serverId: string): Promise<{ ok: boolean; paused: boolean; error?: string }>;
      write(serverId: string, m: JsonRpcMessage): Promise<{ ok: boolean }>;
      status(serverId: string): Promise<{ running: boolean; count: number }>;
      sessionList(): Promise<SessionInfo[]>;
      sessionClose(serverId: string): Promise<{ ok: boolean }>;
      clientRequest(serverId: string, method: string, params?: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }>;
      clientNotify(serverId: string, method: string, params?: unknown): Promise<{ ok: boolean; error?: string }>;
      clientStatus(serverId: string): Promise<{ connected: boolean; server: { name?: string; version?: string; capabilities?: unknown } | null }>;
      clientRestart(serverId: string): Promise<{ ok: boolean; error?: string }>;
      appVersion(): Promise<string>;
      exportSession(serverId: string): Promise<{ ok: boolean; filePath?: string; error?: string }>;
      importSession(serverId: string): Promise<{ ok: boolean; count?: number; error?: string }>;
      loadServers(): Promise<SavedServer[]>;
      saveServers(servers: SavedServer[]): Promise<{ ok: boolean }>;
      loadClients(): Promise<SavedClient[]>;
      saveClients(clients: SavedClient[]): Promise<{ ok: boolean }>;
      interceptList(serverId: string): Promise<InterceptState>;
      interceptAddRule(serverId: string, dir: 'c2s' | 's2c', method: string, simulation?: SimulationConfig): Promise<{ ok: boolean; rule?: InterceptRule }>;
      interceptRemoveRule(serverId: string, id: string): Promise<{ ok: boolean }>;
      interceptToggleRule(serverId: string, id: string, enabled: boolean): Promise<{ ok: boolean }>;
      interceptSetRuleSimulation(serverId: string, id: string, simulation: SimulationConfig | null): Promise<{ ok: boolean }>;
      interceptSetInterceptAll(serverId: string, dir: 'c2s' | 's2c', on: boolean): Promise<{ ok: boolean }>;
      interceptResolve(serverId: string, id: string, resolution: HoldResolution): Promise<{ ok: boolean }>;
      interceptClear(serverId: string): Promise<{ ok: boolean }>;
      clipboardWrite(text: string): Promise<{ ok: boolean }>;
      specGet(): Promise<{ enabled: boolean }>;
      specSet(enabled: boolean): Promise<{ ok: boolean }>;
      onEntry(cb: (e: LogEntry) => void): () => void;
      onExit(cb: (info: { serverId: string; code: number | null; signal: string | null }) => void): () => void;
      onError(cb: (info: { serverId?: string; message: string }) => void): () => void;
      onSessionState(cb: (sessions: SessionInfo[]) => void): () => void;
      onClientConnected(cb: (info: { serverId: string; serverName: string; serverVersion: string }) => void): () => void;
      onClientClosed(cb: (info: { serverId: string }) => void): () => void;
      onClientError(cb: (info: { serverId?: string; message: string }) => void): () => void;
      onInterceptRules(cb: (state: InterceptState) => void): () => void;
      onInterceptHeld(cb: (held: HeldMessage) => void): () => void;
      onInterceptReleased(cb: (info: { serverId: string }) => void): () => void;
      onPausedChanged(cb: (info: { serverId: string; paused: boolean }) => void): () => void;
    };
  }
}

export default function App(): React.ReactElement {
  // ——— Persisted servers/clients ———
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [clients, setClients] = useState<SavedClient[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  // ——— Live sessions (M1) ———
  // One entry per started server. The active tab = selectedServerId:
  // selecting a card focuses that session's tab; starting a server
  // creates/refreshes its session and focuses it.
  const [sessionList, setSessionList] = useState<SessionInfo[]>([]);
  const [sessionEntries, setSessionEntries] = useState<Record<string, LogEntry[]>>({});
  const [clientConnectedMap, setClientConnectedMap] = useState<Record<string, boolean>>({});
  const [serverInfoMap, setServerInfoMap] = useState<Record<string, { name?: string; version?: string; capabilities?: unknown } | null>>({});
  const [exitInfoMap, setExitInfoMap] = useState<Record<string, { code: number | null; signal: string | null } | undefined>>({});
  const [lastToolResult, setLastToolResult] = useState<LogEntry | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('Ready. Select a server and a client to start.');
  // App version (semver MAJOR.MINOR.PATCH — package.json)
  const [appVersion, setAppVersion] = useState<string>('');

  // ——— Wizard state ———
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [showWizard, setShowWizard] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // ——— Intercept state of the ACTIVE session (Phase 6) ———
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

  // ——— Derived: active session ———
  const activeSession = sessionList.find((s) => s.serverId === selectedServerId) ?? null;
  const running = activeSession?.running ?? false;
  const activeEntries = (selectedServerId && sessionEntries[selectedServerId]) || [];
  const exitInfo = (selectedServerId && exitInfoMap[selectedServerId]) ?? null;
  const clientConnected = Boolean(selectedServerId && clientConnectedMap[selectedServerId]);
  const serverInfo = selectedServerId ? (serverInfoMap[selectedServerId] ?? null) : null;

  /** Refreshes the active tab's intercept state from main. */
  const refreshIntercept = useCallback(async () => {
    if (!selectedServerId) return;
    const s = await window.api.interceptList(selectedServerId);
    if (s.serverId && s.serverId === selectedServerId) {
      setInterceptRules(s.rules);
      setInterceptAllC2sState(s.interceptAllC2s);
      setInterceptAllS2cState(s.interceptAllS2c);
      setHeldMessages(s.held);
      if (s.paused !== undefined) setPaused(s.paused);
      if (s.queue !== undefined) setPausedQueue(s.queue);
    }
  }, [selectedServerId]);

  /** Refreshes the active tab's client status from main. */
  const refreshClientStatus = useCallback(async () => {
    if (!selectedServerId) return;
    const s = await window.api.clientStatus(selectedServerId);
    setClientConnectedMap((prev) => ({ ...prev, [selectedServerId]: s.connected }));
    setServerInfoMap((prev) => ({ ...prev, [selectedServerId]: s.server }));
  }, [selectedServerId]);

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
      // Pull live sessions (tabs) — survives renderer reloads
      const live = await window.api.sessionList();
      setSessionList(live);
      setInitialized(true);
    })();
  }, []);

  // ——— IPC event subscriptions ———
  useEffect(() => {
    const offEntry = window.api.onEntry((e) => {
      if (e.serverId) {
        setSessionEntries((prev) => ({ ...prev, [e.serverId!]: [...(prev[e.serverId!] ?? []), e] }));
      }
    });
    const offSessionState = window.api.onSessionState((list) => setSessionList(list));
    const offExit = window.api.onExit((info) => {
      setExitInfoMap((prev) => ({ ...prev, [info.serverId]: { code: info.code, signal: info.signal } }));
      setClientConnectedMap((prev) => ({ ...prev, [info.serverId]: false }));
      setStatusMsg(`Server exit code=${info.code} signal=${info.signal}`);
    });
    const offError = window.api.onError((info) => {
      setStatusMsg(`ERROR${info.serverId ? ` [${info.serverId}]` : ''}: ${info.message}`);
    });
    const offConn = window.api.onClientConnected((info) => {
      setClientConnectedMap((prev) => ({ ...prev, [info.serverId]: true }));
      setStatusMsg(`Client connected to ${info.serverName} v${info.serverVersion} — handshake complete.`);
      void window.api.clientStatus(info.serverId).then((s) => {
        setServerInfoMap((prev) => ({ ...prev, [info.serverId]: s.server }));
      });
    });
    const offClosed = window.api.onClientClosed((info) => {
      setClientConnectedMap((prev) => ({ ...prev, [info.serverId]: false }));
      setStatusMsg('Client disconnected.');
    });
    const offCError = window.api.onClientError((info) => setStatusMsg(`CLIENT ERROR: ${info.message}`));
    const offIRules = window.api.onInterceptRules((state) => {
      // Only the active tab's rules are rendered.
      if (state.serverId && state.serverId === selectedServerIdRef.current) {
        setInterceptRules(state.rules);
        setInterceptAllC2sState(state.interceptAllC2s);
        setInterceptAllS2cState(state.interceptAllS2c);
        setHeldMessages(state.held);
        if (state.paused !== undefined) setPaused(state.paused);
        if (state.queue !== undefined) setPausedQueue(state.queue);
      }
    });
    const offIHeld = window.api.onInterceptHeld(() => { void refreshIntercept(); });
    const offIReleased = window.api.onInterceptReleased(() => { void refreshIntercept(); });
    const offPausedChanged = window.api.onPausedChanged((info) => {
      if (info.serverId === selectedServerIdRef.current) setPaused(info.paused);
    });
    return () => {
      offEntry(); offSessionState(); offExit(); offError(); offConn(); offClosed(); offCError();
      offIRules(); offIHeld(); offIReleased(); offPausedChanged();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // selectedServerId mirrored in a ref so the IPC subscription stays stable
  const selectedServerIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedServerIdRef.current = selectedServerId;
    // Tab switch: re-hydrate the intercept state of the newly active session.
    void refreshIntercept();
    void refreshClientStatus();
  }, [selectedServerId, refreshIntercept, refreshClientStatus]);

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
    // If a live session exists for the deleted server, tear it down.
    if (sessionList.some((s) => s.serverId === id)) {
      void window.api.sessionClose(id);
    }
    if (selectedServerId === id) {
      setSelectedServerId(null);
      setConfig({ command: '', args: [] });
    }
  }, [selectedServerId, sessionList]);

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

  // ——— Start / Stop (per session) ———
  const onStart = useCallback(async () => {
    const server = servers.find((s) => s.id === selectedServerId);
    if (!server) {
      setStatusMsg('Select a server first.');
      return;
    }
    const targetConfig = server.config;
    if (selectedServerId) {
      setSessionEntries((prev) => ({ ...prev, [selectedServerId]: [] }));
    }
    setExitInfoMap((prev) => ({ ...prev, [server.id]: undefined }));
    setLastToolResult(null);
    setStatusMsg('Spawning server + client handshake…');
    const r = await window.api.start(server.id, server.name, targetConfig);
    if (!r.ok) {
      setStatusMsg(`Failed to start: ${r.error ?? 'unknown'}`);
    }
  }, [servers, selectedServerId]);

  // Restart the subprocess with the same config (Phase 5)
  const onRestart = useCallback(async () => {
    if (!selectedServerId) return;
    setStatusMsg('Restarting server…');
    const r = await window.api.restart(selectedServerId);
    if (r.ok) {
      setStatusMsg('Server restarted — session preserved.');
    } else {
      setStatusMsg(`Restart failed: ${r.error ?? 'unknown'}`);
    }
  }, [selectedServerId]);

  // Reset the MCP client: disconnect + reconnect (fresh handshake), without touching the server
  const onClientRestart = useCallback(async () => {
    if (!selectedServerId) return;
    setStatusMsg('Reconnecting client…');
    const r = await window.api.clientRestart(selectedServerId);
    setStatusMsg(r.ok ? 'Client reconnected — handshake complete.' : `Reconnect failed: ${r.error ?? 'unknown'}`);
  }, [selectedServerId]);

  // Kill the subprocess immediately (Phase 5)
  const onKill = useCallback(async () => {
    if (!selectedServerId) return;
    await window.api.killServer(selectedServerId);
    setStatusMsg('Server killed (SIGKILL).');
  }, [selectedServerId]);

  // MITM pause: freeze ALL traffic without killing the subprocess (Phase 6)
  const onPause = useCallback(async () => {
    if (!selectedServerId) return;
    const r = await window.api.pauseServer(selectedServerId);
    if (r.ok) {
      setPaused(true);
      setStatusMsg('Traffic paused — the server stays alive.');
    }
  }, [selectedServerId]);

  // Resume: release the FIFO queue (messages re-enter the pipeline)
  const onResume = useCallback(async () => {
    if (!selectedServerId) return;
    const r = await window.api.resumeServer(selectedServerId);
    if (r.ok) {
      setPaused(false);
      setStatusMsg('Traffic resumed — the queue was released in order.');
    }
  }, [selectedServerId]);

  // Close a session tab: stop the server, keep the saved card.
  const onCloseSession = useCallback(async (serverId: string) => {
    await window.api.sessionClose(serverId);
    setStatusMsg('Session closed — server stopped.');
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

  // ——— Client → server interaction (active session) ———
  const doRequest = useCallback(async (method: string, params?: unknown, label?: string) => {
    if (!selectedServerId) return;
    setStatusMsg(`Sending ${label ?? method}…`);
    const r = await window.api.clientRequest(selectedServerId, method, params);
    if (r.ok) {
      setStatusMsg(`${label ?? method} OK — response in the log.`);
      setLastToolResult({
        seq: -1, ts: new Date().toISOString(), dir: 's2c', kind: 'response',
        rpcId: null, method: label ?? method, result: r.result, raw: JSON.stringify(r.result),
      });
    } else {
      setStatusMsg(`ERROR in ${label ?? method}: ${r.error}`);
    }
  }, [selectedServerId]);

  const onPing = useCallback(() => { void doRequest('ping', undefined, 'ping'); }, [doRequest]);
  const onListTools = useCallback(() => { void doRequest('tools/list', undefined, 'tools/list'); }, [doRequest]);
  const onCallEcho = useCallback(() => {
    void doRequest('tools/call', { name: 'echo', arguments: { message: 'hello from the real MCP client' } }, 'tools/call echo');
  }, [doRequest]);
  const onCallLongRunning = useCallback(() => {
    void doRequest('tools/call', { name: 'longRunningOperation', arguments: { duration: 3, steps: 5 } }, 'tools/call longRunning');
  }, [doRequest]);

  const onSendRaw = useCallback(async (raw: string) => {
    if (!selectedServerId) return;
    try {
      const msg = JSON.parse(raw) as JsonRpcMessage;
      const r = await window.api.write(selectedServerId, msg);
      setStatusMsg(r.ok ? 'Raw sent (c2s in the log).' : 'Server not alive — could not send.');
    } catch {
      setStatusMsg('Invalid JSON — not sent.');
    }
  }, [selectedServerId]);

  const onExport = useCallback(async () => {
    if (!selectedServerId) return;
    const r = await window.api.exportSession(selectedServerId);
    setStatusMsg(r.ok ? `Exported to ${r.filePath}` : `Export canceled (${r.error})`);
  }, [selectedServerId]);

  const onImport = useCallback(async () => {
    if (!selectedServerId) return;
    const r = await window.api.importSession(selectedServerId);
    setStatusMsg(r.ok ? `Imported: ${r.count} entries` : `Import canceled (${r.error})`);
    if (r.ok) {
      const s = await window.api.status(selectedServerId);
      setSessionEntries((prev) => ({ ...prev, [selectedServerId!]: [] }));
      // Entries arrive via the proxy:entry push replay.
      void s;
    }
  }, [selectedServerId]);

  // ——— Intercept handlers (Phase 6+7, active session) ———
  const handleAddRule = useCallback((dir: 'c2s' | 's2c', method: string, simulation?: SimulationConfig) => {
    if (!selectedServerId) return;
    void window.api.interceptAddRule(selectedServerId, dir, method, simulation);
  }, [selectedServerId]);

  const handleRemoveRule = useCallback((id: string) => {
    if (!selectedServerId) return;
    void window.api.interceptRemoveRule(selectedServerId, id);
  }, [selectedServerId]);

  const handleToggleRule = useCallback((id: string, enabled: boolean) => {
    if (!selectedServerId) return;
    void window.api.interceptToggleRule(selectedServerId, id, enabled);
  }, [selectedServerId]);

  const handleSetInterceptAll = useCallback((dir: 'c2s' | 's2c', on: boolean) => {
    if (!selectedServerId) return;
    void window.api.interceptSetInterceptAll(selectedServerId, dir, on);
  }, [selectedServerId]);

  const handleInterceptClear = useCallback(async () => {
    if (!selectedServerId) return;
    await window.api.interceptClear(selectedServerId);
    void refreshIntercept();
  }, [selectedServerId, refreshIntercept]);

  const handleResolveHold = useCallback(async (id: string, resolution: HoldResolution) => {
    if (!selectedServerId) return;
    const r = await window.api.interceptResolve(selectedServerId, id, resolution);
    if (!r.ok) setStatusMsg('The hold was already resolved or does not exist.');
  }, [selectedServerId]);

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
          <span className="pill">{activeEntries.length} messages</span>
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
          <SessionTabs
            sessions={sessionList}
            activeServerId={selectedServerId}
            onSelect={handleSelectServer}
            onClose={onCloseSession}
          />
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
          <LogList entries={activeEntries} />
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