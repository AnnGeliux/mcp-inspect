/**
 * Test end-to-end del flujo completo del inspector:
 *   StdioProxy (spawn everything-server real) + McpClientController (SDK real)
 *
 * Verifica que el cliente SDK hace handshake initialize → initialized sobre
 * los wires del proxy, que las interacciones tools/list + tools/call pasan
 * por el MITM y que las entries c2s/s2c quedan registradas en la timeline.
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
  // (el logging está centralizado en el proxy — el cliente ya no emite entries)

  // 1. Spawn del server real via proxy
  console.log('[1] Spawning everything-server (real MCP server)…');
  proxy.start({
    command: process.execPath,
    args: [serverPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
  await sleep(300);

  // 2. Conectar cliente SDK real al proxy → handshake
  console.log('[2] Connecting SDK client → handshake initialize/initialized…');
  // deliveredWires: sends por el pipeline (interceptables), receives solo lo entregado
  await client.connectToProxy(proxy.deliveredWires(), { name: 'inspector-test-client', version: '0.1.0' });
  const info = client.getServerInfo();
  console.log(`    server: "${info.name}" v${info.version}`);
  console.log(`    capabilities: ${Object.keys((info.capabilities as Record<string, unknown>) ?? {}).join(', ')}`);

  // 3. Interacción: tools/list
  console.log('\n[3] tools/list…');
  const tools = await client.request('tools/list') as { tools: Array<{ name: string }> };
  console.log(`    ${tools.tools.length} tools: ${tools.tools.slice(0, 8).map((t) => t.name).join(', ')}…`);

  // 4. Interacción: tools/call echo
  console.log('\n[4] tools/call echo…');
  const echo = await client.request('tools/call', {
    name: 'echo',
    arguments: { message: 'hola desde el cliente real' },
  }) as { content: Array<{ text?: string }> };
  console.log(`    echo → ${echo.content?.[0]?.text?.slice(0, 60)}`);

  // 5. Interacción: ping
  console.log('\n[5] ping…');
  await client.request('ping');
  console.log('    pong OK');

  // 6. Timeline resultante
  await sleep(200);
  console.log(`\n[6] Timeline MITM (${entries.length} entries):`);
  for (const e of entries) {
    const dir = e.dir === 'c2s' ? '→' : '←';
    const tag = e.method ?? (e.result !== undefined ? '<response>' : e.stderr ? '<stderr>' : '<other>');
    console.log(
      `  [${String(e.seq).padStart(3)}] ${dir} ${e.kind.padEnd(12)} ${tag}${e.rpcId != null ? ` (id=${e.rpcId})` : ''}`
    );
  }

  // 7. Verificación
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
  const noDupes = toolsListC2s === 1 && toolsListResp === 1; // exactamente 1 request + 1 response

  console.log('\n[7] Verificación:');
  console.log(`    initialize c2s:        ${hasInit ? '✓' : '✗ FALTA'}`);
  console.log(`    initialize response:   ${hasInitResp ? '✓' : '✗ FALTA'}`);
  console.log(`    notifications/initialized: ${hasNotif ? '✓' : '✗ FALTA'}`);
  console.log(`    tools/list c2s+s2c:    ${hasToolsList ? '✓' : '✗ FALTA'}`);
  console.log(`    tools/call echo:       ${hasEcho ? '✓' : '✗ FALTA'}`);
  console.log(`    ping:                  ${hasPing ? '✓' : '✗ FALTA'}`);
  console.log(`    sin duplicados:        ${noDupes ? '✓' : '✗ HAY DUPES'}`);

  const allOk = hasInit && hasInitResp && hasNotif && hasToolsList && hasEcho && hasPing && noDupes;
  console.log(`\n${allOk ? '✅ TODO OK — cliente real + server real interactuando via MITM' : '❌ FALLÓ algo'}`);

  // 8. Cleanup
  await client.stop();
  await proxy.stop();

  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('DEMO FAILED:', e);
  process.exit(1);
});