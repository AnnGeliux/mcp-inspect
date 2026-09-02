/**
 * Electron main process entry point.
 * Creates the window, loads the Vite renderer, and exposes IPC for:
 *   - proxy:start (spawn server + connect real MCP client) — multi-session
 *   - proxy:stop / proxy:restart / proxy:kill
 *   - proxy:pause / proxy:resume (MITM freeze)
 *   - proxy:write (client → server, raw)
 *   - client:request / client:notify / client:status / client:restart
 *   - intercept:* (rules, holds, resolution) — per session
 *   - session:list / session:close / session:export / session:import
 *   - servers:load/save · clients:load/save
 *   - clipboard:write · spec:get/set · app:getVersion
 *
 * M1 (multi-server): the old singleton proxy was replaced by a session
 * registry — Map<serverId, Session>. Each session owns its StdioProxy,
 * its MITMPipeline (rules/holds live there), its SDK client and its log
 * entries. All stateful IPC takes a serverId; the renderer shows one tab
 * per session. Phase 8 will add kind 'http' sessions on this registry.
 */

import { app, BrowserWindow, ipcMain, dialog, clipboard } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createRequire } from 'module';
import { StdioProxy } from './proxy';
import { McpClientController } from './mcpClient';
import { validateSpec } from './specValidation';
import {
  LogEntry,
  ServerConfig,
  SessionExport,
  SessionInfo,
  JsonRpcMessage,
  SavedServer,
  SavedClient,
  HoldResolution,
  SimulationConfig,
} from '../shared/types';
import { loadServers as loadServersImpl, saveServers as saveServersImpl, loadClients as loadClientsImpl, saveClients as saveClientsImpl } from './persistence';

const nodeRequire = createRequire(__filename);

// ——— Presets (pre-loaded servers/clients) ——————————————————————————
function defaultServers(everythingPath: string): SavedServer[] {
  return [
    {
      id: 'preset-everything',
      name: 'everything-server (MCP real)',
      description: 'Test MCP server with tools, resources, and prompts',
      preset: true,
      config: {
        command: process.execPath,
        args: [everythingPath],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        connectClient: true,
      },
    },
    {
      id: 'preset-echo',
      name: 'echo (test)',
      description: 'Simple echo server for message testing',
      preset: true,
      config: {
        command: 'node',
        args: ['-e', "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{const m=JSON.parse(d.trim());if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}}));else if(m.method)console.log(JSON.stringify({jsonrpc:'2.0',method:'notifications/message',params:{level:'info',data:m.method}}));});"],
        connectClient: false,
      },
    },
    {
      id: 'preset-echo-crlf',
      name: 'echo CRLF (test)',
      description: 'Echo server with CRLF framing for testing',
      preset: true,
      config: {
        command: 'node',
        args: ['-e', "process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',d=>{b+=d;let n;while((n=b.indexOf('\\\\n'))>=0){const line=b.slice(0,n).replace(/\\\\r$/,'');b=b.slice(n+1);const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{echo:m.method}})+'\\\\r\\\\n');}});"],
        connectClient: false,
      },
    },
  ];
}

function defaultClients(): SavedClient[] {
  return [
    {
      id: 'preset-sdk',
      name: 'SDK Client (@modelcontextprotocol/sdk)',
      description: 'Official MCP client with the TypeScript SDK',
      preset: true,
      config: {
        type: 'sdk',
        name: 'mcp-inspector-client',
        command: 'node',
        args: [],
      },
    },
    {
      id: 'preset-inspector',
      name: 'Inspector oficial',
      description: 'Official MCP inspector via npx',
      preset: true,
      config: {
        type: 'inspector',
        name: 'mcp-inspector-official',
        command: 'npx',
        args: ['@modelcontextprotocol/inspector'],
      },
    },
  ];
}

// ——— Persistence (delegated to persistence.ts) ——————————————————————

async function loadServers(everythingPath: string): Promise<SavedServer[]> {
  const presets = defaultServers(everythingPath);
  return loadServersImpl(presets);
}

async function saveServers(servers: SavedServer[]): Promise<void> {
  await saveServersImpl(servers);
}

async function loadClients(): Promise<SavedClient[]> {
  const presets = defaultClients();
  return loadClientsImpl(presets);
}

async function saveClients(clients: SavedClient[]): Promise<void> {
  await saveClientsImpl(clients);
}

let mainWindow: BrowserWindow | null = null;

// ——— Multi-server session registry (M1) ————————————————————————————

/** A live proxy session — one per started server. */
interface Session {
  /** SavedServer id this session runs. */
  id: string;
  /** Display name (from the SavedServer). */
  name: string;
  /** Config the session was started with. */
  config: ServerConfig;
  /** Transport kind — stdio today; Phase 8 adds 'http'. */
  kind: 'stdio' | 'http';
  /** The MITM proxy owning the subprocess + pipeline. */
  proxy: StdioProxy;
  /** The real SDK client connected to this session's proxy. */
  client: McpClientController;
  /** Traffic log of this session. */
  entries: LogEntry[];
}

const sessions = new Map<string, Session>();

function createSession(serverId: string, name: string, config: ServerConfig): Session {
  const session: Session = {
    id: serverId,
    name,
    config,
    kind: 'stdio',
    proxy: new StdioProxy(),
    client: new McpClientController(),
    entries: [],
  };
  wireSession(session);
  sessions.set(serverId, session);
  return session;
}

/** Registers all proxy/pipeline/client listeners of a session. */
function wireSession(s: Session): void {
  s.proxy.on('entry', (entry: LogEntry) => pushEntry(s, entry));
  s.proxy.on('exit', (code: number | null, signal: string | null) => {
    mainWindow?.webContents.send('proxy:exit', { serverId: s.id, code, signal });
    pushSessionState();
  });
  s.proxy.on('error', (err: Error) => {
    mainWindow?.webContents.send('proxy:error', { serverId: s.id, message: err.message });
  });

  s.proxy.pipeline.on('rulesChanged', () => pushInterceptState(s));
  s.proxy.pipeline.on('held', () => pushInterceptState(s));
  s.proxy.pipeline.on('released', () => {
    mainWindow?.webContents.send('intercept:released', { serverId: s.id });
    pushInterceptState(s);
  });
  s.proxy.pipeline.on('pausedChanged', () => {
    mainWindow?.webContents.send('proxy:pausedChanged', { serverId: s.id, paused: s.proxy.pipeline.paused });
    pushInterceptState(s);
  });
  s.proxy.pipeline.on('queueChanged', () => pushInterceptState(s));

  s.client.on('connected', (info: { serverName: string; serverVersion: string }) => {
    mainWindow?.webContents.send('client:connected', { serverId: s.id, ...info });
  });
  s.client.on('closed', () => {
    mainWindow?.webContents.send('client:closed', { serverId: s.id });
  });
  s.client.on('error', (err: Error) => {
    // "Received a response for an unknown message ID: {huge payload}" —
    // a response arriving AFTER its request expired (e.g. held in
    // pause/hold longer than the client's timeout). Translated short:
    // the full payload is already visible as an s2c entry in the log.
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.startsWith('Received a response for an unknown message ID')
      ? 'Orphan response — the request expired while paused/held and the server replied afterwards. The payload is in the log.'
      : raw;
    mainWindow?.webContents.send('client:error', { serverId: s.id, message });
  });
}

/** Tears a session down: flush holds, stop client + proxy, drop listeners. */
async function closeSession(serverId: string): Promise<void> {
  const s = sessions.get(serverId);
  if (!s) return;
  sessions.delete(serverId);
  try {
    await s.proxy.pipeline.flushAll();
    if (s.client.connected) await s.client.stop();
    if (s.proxy.running) await s.proxy.stop();
  } finally {
    s.proxy.pipeline.removeAllListeners();
    s.proxy.removeAllListeners();
    s.client.removeAllListeners();
  }
  pushSessionState();
}

function sessionSnapshot(): SessionInfo[] {
  return Array.from(sessions.values()).map((s) => ({
    serverId: s.id,
    name: s.name,
    kind: s.kind,
    running: s.proxy.running,
    paused: s.proxy.pipeline.paused,
    queued: s.proxy.pipeline.queueLengths(),
  }));
}

/** Pushes the full session list (tabs) to the renderer. */
function pushSessionState(): void {
  mainWindow?.webContents.send('session:state', sessionSnapshot());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0d1117',
    title: 'MCP Inspector',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // we need node in the preload for IPC
    },
  });

  // Dev: vite dev server. Prod: static index.html.
  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ——— Entry helpers ————————————————————————————————————————————

/** Spec validation enabled (toggled from the UI). Default: on. */
let specValidationOn = true;

function pushEntry(s: Session, entry: LogEntry): void {
  // Phase 5 — spec validation against zod schemas from the SDK.
  // Only MCP entries (stderr/lifecycle carry raw text, not JSON-RPC).
  if (specValidationOn && entry.stderr === undefined) {
    const msg = parseEntryMessage(entry);
    if (msg) {
      const spec = validateSpec(msg, entry.requestMethod);
      if (spec) entry.spec = spec;
    }
  }
  entry.serverId = s.id;
  s.entries.push(entry);
  mainWindow?.webContents.send('proxy:entry', entry);
}

/** Rebuilds the JsonRpcMessage of an entry (to validate against schemas). */
function parseEntryMessage(entry: LogEntry): JsonRpcMessage | null {
  try {
    const m = JSON.parse(entry.raw) as JsonRpcMessage;
    if (m && typeof m === 'object' && 'jsonrpc' in m) return m;
  } catch { /* synthetic entries ([proxy]/[lifecycle]) carry raw text */ }
  return null;
}

/** Synthetic entry for lifecycle events (not JSON-RPC). */
function pushLifecycleEntry(s: Session, kind: 'info' | 'error', message: string): void {
  pushEntry(s, {
    seq: lifecycleSeq++,
    ts: new Date().toISOString(),
    dir: 's2c',
    kind: kind === 'error' ? 'error' : 'notification',
    rpcId: null,
    method: '[lifecycle]',
    raw: message,
    stderr: message,
  });
}
let lifecycleSeq = 900000; // separate range to avoid clashing with proxy/client seq

// ——— Intercept state push (per session) ——————————————————————————

function pushInterceptState(s: Session): void {
  mainWindow?.webContents.send('intercept:rules', {
    serverId: s.id,
    rules: s.proxy.pipeline.listRules(),
    interceptAllC2s: s.proxy.pipeline.getInterceptAll('c2s'),
    interceptAllS2c: s.proxy.pipeline.getInterceptAll('s2c'),
    held: s.proxy.pipeline.listHeld(),
    paused: s.proxy.pipeline.paused,
    queue: s.proxy.pipeline.queueLengths(),
  });
}

// ——— MCP client (SDK) ———————————————————————————————————————————

/** Connects the session's SDK client to its proxy (handshake). Logs the result. */
async function connectClientToProxy(s: Session): Promise<void> {
  try {
    await s.client.connectToProxy(s.proxy.deliveredWires(), {
      name: 'mcp-inspector-client',
      version: '0.1.0',
    });
    const info = s.client.getServerInfo();
    pushLifecycleEntry(s, 'info', `client connected: server "${info.name}" v${info.version} — handshake complete`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushLifecycleEntry(s, 'error', `client connect failed: ${msg}`);
    mainWindow?.webContents.send('client:error', { serverId: s.id, message: msg });
  }
}

// ——— IPC ————————————————————————————————————————————————————————————

ipcMain.handle('proxy:start', async (_evt, args: { serverId: string; name: string; config: ServerConfig }) => {
  try {
    const { serverId, name, config } = args;
    // Replacing an existing session for this server: tear it down first.
    if (sessions.has(serverId)) {
      await closeSession(serverId);
    }
    const s = createSession(serverId, name, config);
    s.proxy.start(config);
    pushLifecycleEntry(s, 'info', `server spawned: ${config.command} ${(config.args ?? []).join(' ')}`);

    // connect the real MCP client (initialize → initialized handshake)
    if (config.connectClient !== false) {
      await connectClientToProxy(s);
    }
    pushSessionState();
    return { ok: true, running: s.proxy.running };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, running: false, error: msg };
  }
});

ipcMain.handle('proxy:stop', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  await s.proxy.pipeline.flushAll();
  if (s.client.connected) await s.client.stop();
  await s.proxy.stop();
  return { ok: true };
});

/** MITM pause: freezes ALL traffic without touching the subprocess. The
 *  server stays alive — messages are queued in the pipeline and flow on resume. */
ipcMain.handle('proxy:pause', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  s.proxy.pipeline.pause();
  pushInterceptState(s);
  pushSessionState();
  return { ok: true, paused: true };
});

/** Resumes frozen traffic: releases the FIFO queue through the pipeline. */
ipcMain.handle('proxy:resume', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  s.proxy.pipeline.resume();
  pushInterceptState(s);
  pushSessionState();
  return { ok: true, paused: false };
});

/** Restart: stop + start with the same config, without clearing the logged session. */
ipcMain.handle('proxy:restart', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  const config = s.config;
  try {
    await s.proxy.pipeline.flushAll();
    if (s.proxy.running) await s.proxy.stop();
    if (s.client.connected) await s.client.stop();
    s.proxy.pipeline.clearCorrelation();
    s.proxy.pipeline.resetPause();
    s.proxy.start(config);
    pushLifecycleEntry(s, 'info', `server restarted: ${config.command} ${(config.args ?? []).join(' ')}`);
    if (config.connectClient !== false) {
      await connectClientToProxy(s);
    }
    pushSessionState();
    return { ok: true, running: s.proxy.running };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

/** Immediate kill of the subprocess (SIGKILL — no grace period). */
ipcMain.handle('proxy:kill', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  await s.proxy.pipeline.flushAll();
  s.proxy.kill();
  return { ok: true };
});

// Raw send (the inspector as a manual client)
ipcMain.handle('proxy:write', async (_evt, args: { serverId: string; msg: JsonRpcMessage }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  const ok = s.proxy.writeClientMessage(args.msg);
  return { ok };
});

// MCP client restart (connection reset): disconnect + reconnect to the
// proxy (initialize → initialized handshake again). The server is NOT touched.
ipcMain.handle('client:restart', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  try {
    if (!s.proxy.running) return { ok: false, error: 'server not running' };
    if (s.client.connected) await s.client.stop();
    await connectClientToProxy(s);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// App version (package.json) to show in the renderer's topbar
ipcMain.handle('app:getVersion', () => app.getVersion());

// MCP request via the real SDK client
ipcMain.handle('client:request', async (_evt, args: { serverId: string; method: string; params?: unknown }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  try {
    const result = await s.client.request(args.method, args.params);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// MCP notification via the real SDK client
ipcMain.handle('client:notify', async (_evt, args: { serverId: string; method: string; params?: unknown }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  try {
    await s.client.notify(args.method, args.params);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// Client status
ipcMain.handle('client:status', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { connected: false, server: null };
  return {
    connected: s.client.connected,
    server: s.client.connected ? s.client.getServerInfo() : null,
  };
});

ipcMain.handle('proxy:status', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { running: false, count: 0 };
  return { running: s.proxy.running, count: s.entries.length };
});

// ——— Sessions ————————————————————————————————————————————————————

ipcMain.handle('session:list', async () => sessionSnapshot());

ipcMain.handle('session:close', async (_evt, args: { serverId: string }) => {
  await closeSession(args.serverId);
  return { ok: true };
});

// ——— Interception IPC (per session) ————————————————————————————

ipcMain.handle('intercept:list', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { rules: [], interceptAllC2s: false, interceptAllS2c: false, held: [], paused: false, queue: { c2s: 0, s2c: 0 } };
  return {
    serverId: s.id,
    rules: s.proxy.pipeline.listRules(),
    interceptAllC2s: s.proxy.pipeline.getInterceptAll('c2s'),
    interceptAllS2c: s.proxy.pipeline.getInterceptAll('s2c'),
    held: s.proxy.pipeline.listHeld(),
    paused: s.proxy.pipeline.paused,
    queue: s.proxy.pipeline.queueLengths(),
  };
});

ipcMain.handle('intercept:addRule', async (_evt, args: { serverId: string; dir: 'c2s' | 's2c'; method: string; simulation?: SimulationConfig }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  const rule = s.proxy.pipeline.addRule(args.dir, args.method, args.simulation);
  return { ok: true, rule };
});

ipcMain.handle('intercept:removeRule', async (_evt, args: { serverId: string; id: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  s.proxy.pipeline.removeRule(args.id);
  return { ok: true };
});

ipcMain.handle('intercept:toggleRule', async (_evt, args: { serverId: string; id: string; enabled: boolean }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  s.proxy.pipeline.toggleRule(args.id, args.enabled);
  return { ok: true };
});

ipcMain.handle('intercept:setRuleSimulation', async (_evt, args: { serverId: string; id: string; simulation: SimulationConfig | null }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  s.proxy.pipeline.setRuleSimulation(args.id, args.simulation);
  return { ok: true };
});

ipcMain.handle('intercept:setInterceptAll', async (_evt, args: { serverId: string; dir: 'c2s' | 's2c'; on: boolean }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  s.proxy.pipeline.setInterceptAll(args.dir, args.on);
  return { ok: true };
});

ipcMain.handle('intercept:resolve', async (_evt, args: { serverId: string; id: string; resolution: HoldResolution }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  const ok = s.proxy.pipeline.resolveHold(args.id, args.resolution);
  return { ok };
});

ipcMain.handle('intercept:clear', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false };
  await s.proxy.pipeline.flushAll();
  return { ok: true };
});

// ——— Clipboard ————————————————————————————————————————————————————

ipcMain.handle('clipboard:write', async (_evt, args: { text: string }) => {
  clipboard.writeText(args.text);
  return { ok: true };
});

// ——— Spec validation ——————————————————————————————————————————

ipcMain.handle('spec:get', async () => ({ enabled: specValidationOn }));
ipcMain.handle('spec:set', async (_evt, args: { enabled: boolean }) => {
  specValidationOn = args.enabled;
  return { ok: true };
});

// Resolve everything-server path (used by presets)
let everythingPath = '';
try {
  everythingPath = nodeRequire.resolve('@modelcontextprotocol/server-everything/dist/index.js');
} catch {
  everythingPath = '';
}

// ——— Persistence IPC handlers ————————————————————————————————

ipcMain.handle('servers:load', async () => {
  return loadServers(everythingPath);
});

ipcMain.handle('servers:save', async (_evt, servers: SavedServer[]) => {
  await saveServers(servers);
  return { ok: true };
});

ipcMain.handle('clients:load', async () => {
  return loadClients();
});

ipcMain.handle('clients:save', async (_evt, clients: SavedClient[]) => {
  await saveClients(clients);
  return { ok: true };
});

ipcMain.handle('session:export', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  const sess: SessionExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: s.config,
    entries: s.entries,
  };
  const win = mainWindow!;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export session',
    defaultPath: `mcp-session-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, error: 'cancelled' };
  await fs.writeFile(filePath, JSON.stringify(sess, null, 2), 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('session:import', async (_evt, args: { serverId: string }) => {
  const s = sessions.get(args.serverId);
  if (!s) return { ok: false, error: 'no session' };
  const win = mainWindow!;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import session',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return { ok: false, error: 'cancelled' };
  const filePath = filePaths[0]!;
  const text = await fs.readFile(filePath, 'utf8');
  const sess = JSON.parse(text) as SessionExport;
  if (sess.version !== 1) return { ok: false, error: 'unsupported version' };
  // Imported entries become part of the target session's log.
  for (const e of sess.entries) e.serverId = s.id;
  s.entries.length = 0;
  s.entries.push(...sess.entries);
  // Replay to the renderer
  for (const e of sess.entries) mainWindow?.webContents.send('proxy:entry', e);
  return { ok: true, count: sess.entries.length };
});

// ——— App lifecycle ——————————————————————————————————————————————————

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  const teardown = Array.from(sessions.values()).map(async (s) => {
    await s.proxy.pipeline.flushAll();
    if (s.client.connected) await s.client.stop();
    await s.proxy.stop();
  });
  Promise.all(teardown).finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});