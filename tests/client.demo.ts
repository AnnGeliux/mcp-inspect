/**
 * End-to-end test of the full inspector flow:
 *   StdioProxy (spawn everything-server real) + McpClientController (SDK real)
 *
 * Verifies that the SDK client performs the initialize → initialized handshake
 * over the proxy wires, that tools/list + tools/call interactions go through
 * the MITM, and that c2s/s2c entries are recorded in the timeline.
 *
 * Ejecutar: npx tsx tests/client.demo.ts
 */

import { StdioProxy } from '../src/main/proxy';
import { McpClientController } from '../src/main/mcpClient';
import { LogEntry } from '../src/shared/types';
import { createRequire } from 'module';

const req = createRequire(__filename);
const serverPath = req.resolve('@modelcontextprotocol/server-everything/dist/index.js');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== Client + Proxy + everything-server: end-to-end ===\n');
  const entries: LogEntry[] = [];

  const proxy = new StdioProxy();
  const client = new McpClientController();

  proxy.on('entry', (e) => entries.push(e));
  // (logging is centralized in the proxy — the client no longer emits entries)

  // 1. Spawn the real server via the proxy
  console.log('[1] Spawning everything-server (real MCP server)…');
  proxy.start({
    command: process.execPath,
    args: [serverPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
  await sleep(300);

  // 2. Connect the real SDK client to the proxy → handshake
  console.log('[2] Connecting SDK client → handshake initialize/initialized…');
  // deliveredWires: sends go through the pipeline (interceptable), receives only what is delivered
  await client.connectToProxy(proxy.deliveredWires(), { name: 'inspector-test-client', version: '0.1.0' });
  const info = client.getServerInfo();
  console.log(`    server: "${info.name}" v${info.version}`);
  console.log(`    capabilities: ${Object.keys((info.capabilities as Record<string, unknown>) ?? {}).join(', ')}`);

  // 3. Interaction: tools/list
  console.log('\n[3] tools/list…');
  const tools = await client.request('tools/list') as { tools: Array<{ name: string }> };
  console.log(`    ${tools.tools.length} tools: ${tools.tools.slice(0, 8).map((t) => t.name).join(', ')}…`);

  // 4. Interaction: tools/call echo
  console.log('\n[4] tools/call echo…');
  const echo = await client.request('tools/call', {
    name: 'echo',
    arguments: { message: 'hello from the real client' },
  }) as { content: Array<{ text?: string }> };
  console.log(`    echo → ${echo.content?.[0]?.text?.slice(0, 60)}`);

  // 5. Interaction: ping
  console.log('\n[5] ping…');
  await client.request('ping');
  console.log('    pong OK');

  // 6. Resulting timeline
  await sleep(200);
  console.log(`\n[6] Timeline MITM (${entries.length} entries):`);
  for (const e of entries) {
    const dir = e.dir === 'c2s' ? '→' : '←';
    const tag = e.method ?? (e.result !== undefined ? '<response>' : e.stderr ? '<stderr>' : '<other>');
    console.log(
      `  [${String(e.seq).padStart(3)}] ${dir} ${e.kind.padEnd(12)} ${tag}${e.rpcId != null ? ` (id=${e.rpcId})` : ''}`
    );
  }

  const hasInit = entries.some((e) => e.dir === 'c2s' && e.method === 'initialize');
  const hasInitResp = entries.some((e) => e.dir === 's2c' && e.kind === 'response' && e.result && typeof e.result === 'object' && 'protocolVersion' in (e.result as Record<string, unknown>));
  const hasNotif = entries.some((e) => e.method === 'notifications/initialized');
  const hasToolsList = entries.some((e) => e.method === 'tools/list');
  const hasEcho = entries.some((e) => e.method === 'tools/call');
  const hasPing = entries.some((e) => e.method === 'ping');
  const toolsListC2s = entries.filter((e) => e.dir === 'c2s' && e.method === 'tools/list').length;
  const toolsListResp = entries.filter(
    (e) =>
      e.dir === 's2c' &&
      e.kind === 'response' &&
      typeof e.result === 'object' &&
      e.result !== null &&
      'tools' in (e.result as Record<string, unknown>)
  ).length;
  const noDupes = toolsListC2s === 1 && toolsListResp === 1; // exactly 1 request + 1 response
  // 7. Verification
  console.log('\n[7] Verification:');
  console.log(`    initialize c2s:        ${hasInit ? '✓' : '✗ MISSING'}`);
  console.log(`    initialize response:   ${hasInitResp ? '✓' : '✗ MISSING'}`);
  console.log(`    notifications/initialized: ${hasNotif ? '✓' : '✗ MISSING'}`);
  console.log(`    tools/list c2s+s2c:    ${hasToolsList ? '✓' : '✗ MISSING'}`);
  console.log(`    tools/call echo:       ${hasEcho ? '✓' : '✗ MISSING'}`);
  console.log(`    ping:                  ${hasPing ? '✓' : '✗ MISSING'}`);
  console.log(`    no duplicates:         ${noDupes ? '✓' : '✗ DUPLICATES'}`);

  const allOk = hasInit && hasInitResp && hasNotif && hasToolsList && hasEcho && hasPing && noDupes;
  console.log(`\n${allOk ? '✅ ALL OK — real client + real server interacting via MITM' : '❌ SOMETHING FAILED'}`);

  // 8. Cleanup
  await client.stop();
  await proxy.stop();

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('DEMO FAILED:', e);
  process.exit(1);
});