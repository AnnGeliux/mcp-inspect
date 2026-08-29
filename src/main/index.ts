/**
 * Entry point del Electron main process.
 * Crea ventana, carga el renderer Vite, y expone IPC para:
 *   - proxy:start (spawn server + conectar cliente MCP real)
 *   - proxy:stop
 *   - proxy:write (cliente → server, raw)
 *   - client:connect / client:request / client:notify (cliente SDK real)
 *   - proxy:onEntry (push al renderer)
 *   - session:export / session:import
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createRequire } from 'module';
import { StdioProxy } from './proxy';
import { McpClientController } from './mcpClient';
import { LogEntry, ServerConfig, SessionExport, JsonRpcMessage, SavedServer, SavedClient } from '../shared/types';
import { loadServers as loadServersImpl, saveServers as saveServersImpl, loadClients as loadClientsImpl, saveClients as saveClientsImpl } from './persistence';

const nodeRequire = createRequire(__filename);

// ——— Presets (pre-loaded servers/clients) ——————————————————————————
function defaultServers(everythingPath: string): SavedServer[] {
  return [
    {
      id: 'preset-everything',
      name: 'everything-server (MCP real)',
      description: 'Server MCP con tools, resources y prompts de prueba',
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
      description: 'Server echo simple para testing de mensajes',
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
      description: 'Server echo con framing CRLF para testing',
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
      description: 'Cliente MCP oficial con SDK TypeScript',
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
      description: 'Inspector MCP oficial via npx',
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
      sandbox: false, // necesitamos node en el preload para IPC
    },
  });

  // Dev: vite dev server. Prod: index.html estático.
  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist-renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ——— helpers de entries ————————————————————————————————————————————

function pushEntry(entry: LogEntry): void {
  sessionEntries.push(entry);
  mainWindow?.webContents.send('proxy:entry', entry);
}

/** Entry sintética para eventos del ciclo de vida (no JSON-RPC). */
function pushLifecycleEntry(kind: 'info' | 'error', message: string): void {
  pushEntry({
    seq: lifecycleSeq++,
    ts: new Date().toISOString(),
    dir: 's2c',
    kind: kind === 'error' ? 'error' : 'notification',
    rpcId: null,
    method: `[lifecycle]`,
    raw: message,
    stderr: message,
  });
}
let lifecycleSeq = 900000; // rango separado para no chocar con seq del proxy/cliente

// ——— Proxy listeners (una sola vez) ————————————————————————————————

proxy.on('entry', pushEntry);
proxy.on('exit', (code, signal) => {
  mainWindow?.webContents.send('proxy:exit', { code, signal });
});
proxy.on('error', (err) => {
  mainWindow?.webContents.send('proxy:error', { message: err.message });
});

// ——— Cliente MCP (SDK) —————————————————————————————————————————————

mcpClient.on('entry', pushEntry);
mcpClient.on('connected', (info) => {
  mainWindow?.webContents.send('client:connected', info);
});
mcpClient.on('closed', () => {
  mainWindow?.webContents.send('client:closed');
});
mcpClient.on('error', (err) => {
  mainWindow?.webContents.send('client:error', { message: err.message });
});

// ——— IPC ————————————————————————————————————————————————————————————

ipcMain.handle('proxy:start', async (_evt, config: ServerConfig) => {
  try {
    // stop de sesión previa (si había)
    if (proxy.running) {
      await proxy.stop();
    }
    if (mcpClient.connected) {
      await mcpClient.stop();
    }

    sessionConfig = config;
    sessionEntries.length = 0;

    // spawn del server
    proxy.start(config);
    pushLifecycleEntry('info', `server spawned: ${config.command} ${(config.args ?? []).join(' ')}`);

    // conectar cliente MCP real (handshake initialize → initialized)
    if (config.connectClient !== false) {
      try {
        await mcpClient.connectToProxy(proxy.wires(), {
          name: 'mcp-inspector-client',
          version: '0.1.0',
        });
        const info = mcpClient.getServerInfo();
        pushLifecycleEntry(
          'info',
          `client connected: server "${info.name}" v${info.version} — handshake complete`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushLifecycleEntry('error', `client connect failed: ${msg}`);
        mainWindow?.webContents.send('client:error', { message: msg });
      }
    }

    return { ok: true, running: proxy.running };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, running: false, error: msg };
  }
});

ipcMain.handle('proxy:stop', async () => {
  if (mcpClient.connected) {
    await mcpClient.stop();
  }
  await proxy.stop();
  return { ok: true };
});

// Envío raw (como antes: el inspector como cliente manual)
ipcMain.handle('proxy:write', async (_evt, msg: JsonRpcMessage) => {
  const ok = proxy.writeClientMessage(msg);
  return { ok };
});

// Request MCP via cliente SDK real
ipcMain.handle('client:request', async (_evt, args: { method: string; params?: unknown }) => {
  try {
    const result = await mcpClient.request(args.method, args.params);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// Notification MCP via cliente SDK real
ipcMain.handle('client:notify', async (_evt, args: { method: string; params?: unknown }) => {
  try {
    await mcpClient.notify(args.method, args.params);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
});

// Estado del cliente
ipcMain.handle('client:status', async () => {
  return {
    connected: mcpClient.connected,
    server: mcpClient.connected ? mcpClient.getServerInfo() : null,
  };
});

ipcMain.handle('proxy:status', async () => {
  return { running: proxy.running, count: sessionEntries.length };
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
  // Replay al renderer
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
  Promise.all([mcpClient.stop(), proxy.stop()]).finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});