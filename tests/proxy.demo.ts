/**
 * End-to-end demo of the StdioProxy.
 *
 * Spawns a Node subprocess ("echo MCP") that responds to initialize and tools/list.
 * The proxy captures stdout (NDJSON) and stderr. The demo writes an initialize
 * request and verifies it receives the response as a LogEntry.
 *
 * Ejecutar: npm run test:proxy
 */

import { StdioProxy } from '../src/main/proxy';
import { LogEntry } from '../src/shared/types';

// Test subprocess: a mini "MCP server" responding to initialize, ping,
// and notifications/initialized.
const ECHO_NODE = `
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, nl).replace(/\\r$/, '');
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if ('id' in msg && msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'echo-server', version: '0.0.1' },
          instructions: 'I am an echo server for testing the proxy.'
        }
      }) + '\\n');
    } else if ('id' in msg && msg.method === 'ping') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n');
    } else if ('id' in msg && msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          tools: [
            { name: 'echo', description: 'Echoes input', inputSchema: { type: 'object' } },
            { name: 'add', description: 'Adds numbers', inputSchema: { type: 'object' } }
          ]
        }
      }) + '\\n');
    } else if ('method' in msg && !('id' in msg)) {
      // notification — we don't respond
    }
  }
});
process.stderr.write('echo-server started\\n');
`;

async function main() {
  console.log('=== StdioProxy end-to-end demo ===\n');
  const proxy = new StdioProxy();
  const entries: LogEntry[] = [];

  proxy.on('entry', (e: LogEntry) => {
    entries.push(e);
    const dir = e.dir === 'c2s' ? '→' : '←';
    const tag = e.method ?? (e.result !== undefined ? '<response>' : '<err>');
    console.log(`  [${e.seq.toString().padStart(3)}] ${dir} ${e.kind.padEnd(12)} ${tag}${e.rpcId != null ? ` (id=${e.rpcId})` : ''}${e.error ? ` [${e.error.code}]` : ''}`);
  });
  proxy.on('exit', (code, signal) => console.log(`\n[proxy] exit code=${code} signal=${signal}`));
  proxy.on('error', (err) => console.error(`[proxy error] ${err.message}`));

  // 1. Start the subprocess
  console.log('[1] Spawning echo-server…');
  proxy.start({
    command: process.execPath, // node
    args: ['-e', ECHO_NODE],
  });
  await sleep(150);

  // 2. Client → server: initialize
  console.log('\n[2] Sending initialize (id=1)…');
  const ok1 = proxy.writeClientMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: { roots: {} }, clientInfo: { name: 'demo', version: '0' } },
  });
  if (!ok1) throw new Error('writeClientMessage failed for initialize');
  await sleep(150);

  // 3. Client → server: initialized notification
  console.log('[3] Sending notifications/initialized (no id)…');
  proxy.writeClientMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await sleep(50);

  // 4. Client → server: tools/list
  console.log('[4] Sending tools/list (id=2)…');
  proxy.writeClientMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  await sleep(150);

  // 5. Client → server: ping
  console.log('[5] Sending ping (id=3)…');
  proxy.writeClientMessage({ jsonrpc: '2.0', id: 3, method: 'ping' });
  await sleep(150);

  // 6. Stop
  console.log('\n[6] Stopping proxy…');
  await proxy.stop(2000);

  // 7. Verifications
  console.log('\n=== Verifications ===');
  let pass = 0, fail = 0;
  function check(name: string, ok: boolean, detail = '') {
    if (ok) { console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); pass++; }
    else    { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); fail++; }
  }
  check('At least 8 entries (4 c2s + 3 s2c responses + 1 stderr + 1 notification)',
    entries.length >= 8, `got ${entries.length}`);

  const initializeResp = entries.find((e) => e.dir === 's2c' && e.rpcId === 1 && (e.result !== undefined || e.error !== undefined));
  check('initialize response received', !!initializeResp, initializeResp?.result ? JSON.stringify(initializeResp.result).slice(0, 80) + '…' : 'missing');

  const initializedNotif = entries.find((e) => e.method === 'notifications/initialized');
  check('notifications/initialized logged', !!initializedNotif);

  const toolsListResp = entries.find((e) => e.dir === 's2c' && e.rpcId === 2 && (e.result as any)?.tools);
  check('tools/list response received with 2 tools',
    !!toolsListResp && Array.isArray((toolsListResp.result as any)?.tools) && (toolsListResp.result as any).tools.length === 2);

  const pingResp = entries.find((e) => e.dir === 's2c' && e.rpcId === 3);
  check('ping response received', !!pingResp);

  const stderrEntry = entries.find((e) => e.stderr);
  check('stderr captured separately from the MCP channel', !!stderrEntry);

  const c2sCount = entries.filter((e) => e.dir === 'c2s').length;
  const s2cCount = entries.filter((e) => e.dir === 's2c' && !e.stderr && e.method !== '[proxy]').length;
  check('4 c2s messages (initialize + initialized + tools/list + ping)', c2sCount === 4, `got ${c2sCount}`);
  check('3 s2c messages with responses (initialize + tools/list + ping)', s2cCount === 3, `got ${s2cCount}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => { console.error('FATAL:', err); process.exit(2); });
