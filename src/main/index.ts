/**
 * Electron main process entry point.
 * Creates the window, loads the Vite renderer, and exposes IPC for:
 *   - proxy:start (spawn server + connect real MCP client)
 *   - proxy:stop / proxy:restart / proxy:kill
 *   - proxy:write (client → server, raw)
 *   - client:request / client:notify / client:status (real SDK client)
 *   - proxy:status
 *   - intercept:* (rules, holds, resolution)
 *   - clipboard:write · spec:get/set
 *   - session:export / session:import
 *   - servers:load/save · clients:load/save
 *
 * Phase 5: every entry is enriched with latency (rpcId correlation done in
 * the proxy/pipeline) and spec validation (zod schemas from the SDK).
 * Phase 6: the interception pipeline lives in the proxy; here we only
 * expose its control and push state to the renderer.
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
const proxy = new StdioProxy();
const mcpClient = new McpClientController();
const sessionEntries: LogEntry[] = [];
let sessionConfig: ServerConfig | null = null;

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

function pushEntry(entry: LogEntry): void {
  // Phase 5 — spec validation against zod schemas from the SDK.
  // Only MCP entries (stderr/lifecycle carry raw text, not JSON-RPC).
  if (specValidationOn && entry.stderr === undefined) {
    const msg = parseEntryMessage(entry);
    if (msg) {
      const spec = validateSpec(msg, entry.requestMethod);
      if (spec) entry.spec = spec;
    }
  }
  sessionEntries.push(entry);
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
function pushLifecycleEntry(kind: 'info' | 'error', message: string): void {
  pushEntry({
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

// ——— Proxy listeners (registered once) ———————————————————————————

proxy.on('entry', pushEntry);
proxy.on('exit', (code, signal) => {
  mainWindow?.webContents.send('proxy:exit', { code, signal });
});
proxy.on('error', (err) => {
  mainWindow?.webContents.send('proxy:error', { message: err.message });
});

// ——— Interception: push pipeline state ——————————————————————————

function pushInterceptState(): void {
  mainWindow?.webContents.send('intercept:rules', {
    rules: proxy.pipeline.listRules(),
    interceptAllC2s: proxy.pipeline.getInterceptAll('c2s'),
    interceptAllS2c: proxy.pipeline.getInterceptAll('s2c'),
    held: proxy.pipeline.listHeld(),
    paused: proxy.pipeline.paused,
    queue: proxy.pipeline.queueLengths(),
  });
}

proxy.pipeline.on('rulesChanged', pushInterceptState);
proxy.pipeline.on('held', () => {
  pushInterceptState();
});
proxy.pipeline.on('released', () => {
  mainWindow?.webContents.send('intercept:released');
  pushInterceptState();
});
proxy.pipeline.on('pausedChanged', () => {
  mainWindow?.webContents.send('proxy:pausedChanged', { paused: proxy.pipeline.paused });
  pushInterceptState();
});
proxy.pipeline.on('queueChanged', () => {
  pushInterceptState();
});

// ——— MCP client (SDK) ———————————————————————————————————————————

mcpClient.on('connected', (info) => {
  mainWindow?.webContents.send('client:connected', info);
});
mcpClient.on('closed', () => {
  mainWindow?.webContents.send('client:closed');
});
mcpClient.on('error', (err) => {
  // "Received a response for an unknown message ID: {huge payload}" —
  // a response arriving AFTER its request expired (e.g. held in
  // pause/hold longer than the client's timeout). Translated short:
  // the full payload is already visible as an s2c entry in the log.
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw.startsWith('Received a response for an unknown message ID')
    ? 'Orphan response — the request expired while paused/held and the server replied afterwards. The payload is in the log.'
    : raw;
  mainWindow?.webContents.send('client:error', { message });
});

// ——— Session helpers ———————————————————————————————————————————

/** Connects the SDK client to the proxy (handshake). Logs the result. */
async function connectClientToProxy(): Promise<void> {
  try {
    await mcpClient.connectToProxy(proxy.deliveredWires(), {
      name: 'mcp-inspector-client',
      version: '0.1.0',
    });
    const info = mcpClient.getServerInfo();
    pushLifecycleEntry('info', `client connected: server "${info.name}" v${info.version} — handshake complete`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushLifecycleEntry('error', `client connect failed: ${msg}`);
    mainWindow?.webContents.send('client:error', { message: msg });
  }
}

// ——— IPC ————————————————————————————————————————————————————————————

ipcMain.handle('proxy:start', async (_evt, config: ServerConfig) => {
  try {
    // stop any previous session (if there was one)
    if (proxy.running) {
      await proxy.stop();
    }
    if (mcpClient.connected) {
      await mcpClient.stop();
    }

    sessionConfig = config;
    sessionEntries.length = 0;
    proxy.pipeline.clearCorrelation();
    proxy.pipeline.resetPause();

    // spawn the server
    proxy.start(config);
    pushLifecycleEntry('info', `server spawned: ${config.command} ${(config.args ?? []).join(' ')}`);

    // connect the real MCP client (initialize → initialized handshake)
    if (config.connectClient !== false) {
      await connectClientToProxy();
    }

    return { ok: true, running: proxy.running };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, running: false, error: msg };
  }
});

ipcMain.handle('proxy:stop', async () => {
  await proxy.pipeline.flushAll();
  if (mcpClient.connected) {
    await mcpClient.stop();
  }
  await proxy.stop();
  return { ok: true };
});

/** MITM pause: freezes ALL traffic without touching the subprocess. The
 * server stays alive — messages are queued in the pipeline and flow on resume. */
ipcMain.handle('proxy:pause', async () => {
  proxy.pipeline.pause();
  pushInterceptState();
  return { ok: true, paused: true };
});

/** Resumes frozen traffic: releases the FIFO queue through the pipeline. */
ipcMain.handle('proxy:resume', async () => {
  proxy.pipeline.resume();
  pushInterceptState();
  return { ok: true, paused: false };
});

/** Restart: stop + start with the same config, without clearing the logged session. */
ipcMain.handle('proxy:restart', async () => {
  if (!sessionConfig) return { ok: false, error: 'no session' };
  const config = sessionConfig;
  try {
    await proxy.pipeline.flushAll();
    if (proxy.running) {
      await proxy.stop();
    }
    if (mcpClient.connected) {
      await mcpClient.stop();
    }
    proxy.pipeline.clearCorrelation();
    proxy.pipeline.resetPause();
    proxy.start(config);
    pushLifecycleEntry('info', `server restarted: ${config.command} ${(config.args ?? []).join(' ')}`);
    if (config.connectClient !== false) {
      await connectClientToProxy();
    }
    return { ok: true, running: proxy.running };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

/** Immediate kill of the subprocess (SIGKILL — no grace period). */
ipcMain.handle('proxy:kill', async () => {
  await proxy.pipeline.flushAll();
  proxy.kill();
  return { ok: true };
});

// Raw send (the inspector as a manual client)
ipcMain.handle('proxy:write', async (_evt, msg: JsonRpcMessage) => {
  const ok = proxy.writeClientMessage(msg);
  return { ok };
});

// MCP client restart (connection reset): disconnect + reconnect to the
// proxy (initialize → initialized handshake again). The server is NOT touched.
ipcMain.handle('client:restart', async () => {
  try {
    if (!proxy.running) return { ok: false, error: 'server not running' };
    if (mcpClient.connected) {
      await mcpClient.stop();
    }
    await connectClientToProxy();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// App version (package.json) to show in the renderer's topbar
ipcMain.handle('app:getVersion', () => app.getVersion());

// MCP request via the real SDK client
ipcMain.handle('client:request', async (_evt, args: { method: string; params?: unknown }) => {
  try {
    const result = await mcpClient.request(args.method, args.params);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// MCP notification via the real SDK client
ipcMain.handle('client:notify', async (_evt, args: { method: string; params?: unknown }) => {
  try {
    await mcpClient.notify(args.method, args.params);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// Client status
ipcMain.handle('client:status', async () => {
  return {
    connected: mcpClient.connected,
    server: mcpClient.connected ? mcpClient.getServerInfo() : null,
  };
});

ipcMain.handle('proxy:status', async () => {
  return { running: proxy.running, count: sessionEntries.length };
});

// ——— Interception IPC ——————————————————————————————————————————

ipcMain.handle('intercept:list', async () => {
  return {
    rules: proxy.pipeline.listRules(),
    interceptAllC2s: proxy.pipeline.getInterceptAll('c2s'),
    interceptAllS2c: proxy.pipeline.getInterceptAll('s2c'),
    held: proxy.pipeline.listHeld(),
    paused: proxy.pipeline.paused,
    queue: proxy.pipeline.queueLengths(),
  };
});

ipcMain.handle('intercept:addRule', async (_evt, args: { dir: 'c2s' | 's2c'; method: string; simulation?: SimulationConfig }) => {
  const rule = proxy.pipeline.addRule(args.dir, args.method, args.simulation);
  return { ok: true, rule };
});

ipcMain.handle('intercept:removeRule', async (_evt, args: { id: string }) => {
  proxy.pipeline.removeRule(args.id);
  return { ok: true };
});

ipcMain.handle('intercept:toggleRule', async (_evt, args: { id: string; enabled: boolean }) => {
  proxy.pipeline.toggleRule(args.id, args.enabled);
  return { ok: true };
});

ipcMain.handle('intercept:setRuleSimulation', async (_evt, args: { id: string; simulation: SimulationConfig | null }) => {
  proxy.pipeline.setRuleSimulation(args.id, args.simulation);
  return { ok: true };
});

ipcMain.handle('intercept:setInterceptAll', async (_evt, args: { dir: 'c2s' | 's2c'; on: boolean }) => {
  proxy.pipeline.setInterceptAll(args.dir, args.on);
  return { ok: true };
});

ipcMain.handle('intercept:resolve', async (_evt, args: { id: string; resolution: HoldResolution }) => {
  const ok = proxy.pipeline.resolveHold(args.id, args.resolution);
  return { ok };
});

ipcMain.handle('intercept:clear', async () => {
  await proxy.pipeline.flushAll();
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

ipcMain.handle('session:export', async () => {
  if (!sessionConfig) return { ok: false, error: 'no session' };
  const sess: SessionExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: sessionConfig,
    entries: sessionEntries,
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

ipcMain.handle('session:import', async () => {
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
  sessionConfig = sess.config;
  sessionEntries.length = 0;
  sessionEntries.push(...sess.entries);
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
  Promise.all([proxy.pipeline.flushAll(), mcpClient.stop(), proxy.stop()]).finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});