/**
 * Tests for the persistence layer (servers/clients save/load).
 * Tests that presets are NOT persisted, only user-added servers/clients.
 *
 * Run with: node --test --import tsx tests/persistence.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  loadServers,
  saveServers,
  loadClients,
  saveClients,
} from '../src/main/persistence.ts';
import { SavedServer, SavedClient } from '../src/shared/types.ts';

// ——— Helpers ———

async function makeTempFile(): Promise<string> {
  const tmpDir = os.tmpdir();
  const name = `mcp-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  return path.join(tmpDir, name);
}

async function readJson(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

// ——— Fixtures ———

const presetServers: SavedServer[] = [
  {
    id: 'preset-everything',
    name: 'everything-server',
    preset: true,
    config: { command: 'node', args: ['server.js'] },
  },
  {
    id: 'preset-echo',
    name: 'echo (test)',
    preset: true,
    config: { command: 'node', args: ['-e', 'process.exit(0)'] },
  },
];

const customServer: SavedServer = {
  id: 's-custom',
  name: 'My Custom Server',
  config: { command: 'npx', args: ['-y', '@some/package'] },
};

const presetClients: SavedClient[] = [
  {
    id: 'preset-sdk',
    name: 'SDK Client',
    preset: true,
    config: { type: 'sdk', name: 'sdk-client', command: 'node', args: [] },
  },
];

const customClient: SavedClient = {
  id: 'c-custom',
  name: 'My Custom Client',
  config: { type: 'sdk', name: 'custom', command: 'node', args: [] },
};

// ——— Server tests ———

test('persistence: saveServers writes only non-preset servers to file', async () => {
  const filePath = await makeTempFile();
  try {
    const allServers = [...presetServers, customServer];
    await saveServers(allServers, filePath);

    const written = await readJson(filePath) as SavedServer[];
    assert.ok(Array.isArray(written), 'file should contain an array');
    assert.equal(written.length, 1, 'should persist only 1 server (the custom one)');
    assert.equal(written[0]!.id, 's-custom', 'should be the custom server');
    assert.equal(written[0]!.preset, undefined, 'custom server should not have preset flag');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('persistence: loadServers merges presets with user data', async () => {
  const filePath = await makeTempFile();
  try {
    // Write only custom server to file
    await fs.writeFile(filePath, JSON.stringify([customServer], null, 2), 'utf8');

    // Load with presets — should merge
    const loaded = await loadServers(presetServers, filePath);
    assert.equal(loaded.length, 3, 'should have 3 servers (2 presets + 1 custom)');
    assert.equal(loaded[0]!.id, 'preset-everything', 'preset should be first');
    assert.equal(loaded[1]!.id, 'preset-echo', 'second preset should be second');
    assert.equal(loaded[2]!.id, 's-custom', 'custom server should be last');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('persistence: loadServers returns only presets when file does not exist', async () => {
  const filePath = path.join(os.tmpdir(), `nonexistent-${Date.now()}.json`);
  const loaded = await loadServers(presetServers, filePath);
  assert.equal(loaded.length, 2, 'should return only presets when file is missing');
  assert.equal(loaded[0]!.id, 'preset-everything', 'first preset should be returned');
});

test('persistence: saveServers then loadServers round-trips correctly', async () => {
  const filePath = await makeTempFile();
  try {
    const allServers = [...presetServers, customServer];
    await saveServers(allServers, filePath);

    // Load back with the same presets
    const loaded = await loadServers(presetServers, filePath);
    assert.equal(loaded.length, 3, 'should load 3 servers (2 presets + 1 custom)');
    const custom = loaded.find((s) => s.id === 's-custom');
    assert.ok(custom, 'custom server should be in loaded list');
    assert.equal(custom!.name, 'My Custom Server');
    assert.deepEqual(custom!.config.args, ['-y', '@some/package']);
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('persistence: presets in file are ignored on load (only non-preset loaded)', async () => {
  const filePath = await makeTempFile();
  try {
    // Write a file that incorrectly contains a preset (should be filtered out)
    const fileContent = [
      { id: 'preset-hacked', name: 'Hacked Preset', preset: true, config: { command: 'x', args: [] } },
      customServer,
    ];
    await fs.writeFile(filePath, JSON.stringify(fileContent, null, 2), 'utf8');

    const loaded = await loadServers(presetServers, filePath);
    // Should only have the 2 original presets + 1 custom (the "preset-hacked" should be filtered)
    assert.equal(loaded.length, 3, 'should have 3 servers (2 original presets + 1 custom)');
    const hacked = loaded.find((s) => s.id === 'preset-hacked');
    assert.equal(hacked, undefined, 'preset from file should NOT be loaded');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('persistence: deleting a custom server updates the file', async () => {
  const filePath = await makeTempFile();
  try {
    // Save 2 custom servers + presets
    const customServer2: SavedServer = {
      id: 's-custom-2',
      name: 'Second Custom',
      config: { command: 'node', args: ['app.js'] },
    };
    const allServers = [...presetServers, customServer, customServer2];
    await saveServers(allServers, filePath);

    // Verify both are in file
    let written = await readJson(filePath) as SavedServer[];
    assert.equal(written.length, 2, 'should have 2 custom servers in file');

    // Now "delete" customServer2 — only keep presets + customServer
    const remaining = [...presetServers, customServer];
    await saveServers(remaining, filePath);

    // File should now only have 1 custom server
    written = await readJson(filePath) as SavedServer[];
    assert.equal(written.length, 1, 'should have 1 custom server after deletion');
    assert.equal(written[0]!.id, 's-custom', 'remaining should be s-custom');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

// ——— Client tests ———

test('persistence: saveClients writes only non-preset clients to file', async () => {
  const filePath = await makeTempFile();
  try {
    const allClients = [...presetClients, customClient];
    await saveClients(allClients, filePath);

    const written = await readJson(filePath) as SavedClient[];
    assert.ok(Array.isArray(written), 'file should contain an array');
    assert.equal(written.length, 1, 'should persist only 1 client (the custom one)');
    assert.equal(written[0]!.id, 'c-custom', 'should be the custom client');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('persistence: loadClients merges presets with user data', async () => {
  const filePath = await makeTempFile();
  try {
    await fs.writeFile(filePath, JSON.stringify([customClient], null, 2), 'utf8');

    const loaded = await loadClients(presetClients, filePath);
    assert.equal(loaded.length, 2, 'should have 2 clients (1 preset + 1 custom)');
    assert.equal(loaded[0]!.id, 'preset-sdk', 'preset should be first');
    assert.equal(loaded[1]!.id, 'c-custom', 'custom client should be last');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('persistence: loadClients returns only presets when file does not exist', async () => {
  const filePath = path.join(os.tmpdir(), `nonexistent-${Date.now()}.json`);
  const loaded = await loadClients(presetClients, filePath);
  assert.equal(loaded.length, 1, 'should return only presets when file is missing');
  assert.equal(loaded[0]!.id, 'preset-sdk', 'preset should be returned');
});

test('persistence: saveClients then loadClients round-trips correctly', async () => {
  const filePath = await makeTempFile();
  try {
    const allClients = [...presetClients, customClient];
    await saveClients(allClients, filePath);

    const loaded = await loadClients(presetClients, filePath);
    assert.equal(loaded.length, 2, 'should load 2 clients (1 preset + 1 custom)');
    const custom = loaded.find((c) => c.id === 'c-custom');
    assert.ok(custom, 'custom client should be in loaded list');
    assert.equal(custom!.name, 'My Custom Client');
    assert.equal(custom!.config.type, 'sdk');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});

test('persistence: deleting a custom client updates the file', async () => {
  const filePath = await makeTempFile();
  try {
    const customClient2: SavedClient = {
      id: 'c-custom-2',
      name: 'Second Custom',
      config: { type: 'inspector', name: 'custom2', command: 'npx', args: ['x'] },
    };
    const allClients = [...presetClients, customClient, customClient2];
    await saveClients(allClients, filePath);

    let written = await readJson(filePath) as SavedClient[];
    assert.equal(written.length, 2, 'should have 2 custom clients in file');

    // Delete customClient2
    const remaining = [...presetClients, customClient];
    await saveClients(remaining, filePath);

    written = await readJson(filePath) as SavedClient[];
    assert.equal(written.length, 1, 'should have 1 custom client after deletion');
    assert.equal(written[0]!.id, 'c-custom', 'remaining should be c-custom');
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
});