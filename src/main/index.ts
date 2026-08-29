/**
 * Entry point del Electron main process.
 * Crea ventana, carga el renderer Vite, y expone IPC para:
 *   - proxy:start (spawn)
 *   - proxy:stop
 *   - proxy:write (cliente → server)
 *   - proxy:onEntry (push al renderer)
 *   - session:export / session:import
 */
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { StdioProxy } from './proxy';
import { LogEntry, ServerConfig, SessionExport, JsonRpcMessage } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
const proxy = new StdioProxy();
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

// --- IPC ----------------------------------------------------------------

ipcMain.handle('proxy:start', async (_evt, config: ServerConfig) => {
  sessionConfig = config;
  sessionEntries.length = 0;

  proxy.on('entry', (entry: LogEntry) => {
    sessionEntries.push(entry);
    mainWindow?.webContents.send('proxy:entry', entry);
  });
  proxy.on('exit', (code, signal) => {
    mainWindow?.webContents.send('proxy:exit', { code, signal });
  });
  proxy.on('error', (err) => {
    mainWindow?.webContents.send('proxy:error', { message: err.message });
  });

  proxy.start(config);
  return { ok: true, running: proxy.running };
});

ipcMain.handle('proxy:stop', async () => {
  await proxy.stop();
  return { ok: true };
});

ipcMain.handle('proxy:write', async (_evt, msg: JsonRpcMessage) => {
  const ok = proxy.writeClientMessage(msg);
  return { ok };
});

ipcMain.handle('proxy:status', async () => {
  return { running: proxy.running, count: sessionEntries.length };
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

// --- App lifecycle ------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  proxy.stop().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});
