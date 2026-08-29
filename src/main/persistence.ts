/**
 * Persistence layer for MCP Inspector servers/clients.
 * Extracted from index.ts so it can be unit-tested without Electron.
 *
 * Only non-preset (user-added) servers/clients are persisted to JSON files.
 * Presets are always re-derived on load and merged with user data.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SavedServer, SavedClient } from '../shared/types';

const CONFIG_DIR = path.join(os.homedir(), '.mcp-inspector');

export function getServersFile(): string {
  return path.join(CONFIG_DIR, 'servers.json');
}

export function getClientsFile(): string {
  return path.join(CONFIG_DIR, 'clients.json');
}

export async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

/**
 * Load saved servers from JSON file, merging presets (always re-derived)
 * with user-added servers (persisted). Only non-preset entries are loaded
 * from disk; presets are always prepended from the `presets` argument.
 */
export async function loadServers(
  presets: SavedServer[],
  filePath: string = getServersFile(),
): Promise<SavedServer[]> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const userServers = JSON.parse(text) as SavedServer[];
    const userOnly = userServers.filter((s) => !s.preset);
    return [...presets, ...userOnly];
  } catch {
    return presets;
  }
}

/**
 * Save servers to JSON file. Only non-preset (user-added) servers are
 * persisted; presets are always re-derived on load.
 */
export async function saveServers(
  servers: SavedServer[],
  filePath: string = getServersFile(),
): Promise<void> {
  await ensureConfigDir();
  const userServers = servers.filter((s) => !s.preset);
  await fs.writeFile(filePath, JSON.stringify(userServers, null, 2), 'utf8');
}

/** Load saved clients from JSON file, merging presets with user-added. */
export async function loadClients(
  presets: SavedClient[],
  filePath: string = getClientsFile(),
): Promise<SavedClient[]> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const userClients = JSON.parse(text) as SavedClient[];
    const userOnly = userClients.filter((c) => !c.preset);
    return [...presets, ...userOnly];
  } catch {
    return presets;
  }
}

/** Save clients to JSON file. Only non-preset clients are persisted. */
export async function saveClients(
  clients: SavedClient[],
  filePath: string = getClientsFile(),
): Promise<void> {
  await ensureConfigDir();
  const userClients = clients.filter((c) => !c.preset);
  await fs.writeFile(filePath, JSON.stringify(userClients, null, 2), 'utf8');
}