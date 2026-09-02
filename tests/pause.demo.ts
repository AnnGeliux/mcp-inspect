/**
 * E2E demo: MITM pause with a real subprocess.
 * Verifies that pause() does NOT kill the process, queues the traffic,
 * and that resume() releases it in FIFO order.
 * Run: npx tsx tests/pause.demo.ts
 */
import { StdioProxy } from '../src/main/proxy';
import { LogEntry } from '../src/shared/types';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const proxy = new StdioProxy();
  const entries: LogEntry[] = [];
  proxy.on('entry', (e) => entries.push(e));

  // echo server (inspector preset): responds {ok:true} to each request
  proxy.start({
    command: 'node',
    args: ['-e', "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{for(const line of d.trim().split('\\n')){const m=JSON.parse(line);if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}}));}});"],
    connectClient: false,
  } as never);
  await sleep(300);

  // ——— PAUSE ———
  proxy.pipeline.pause();
  console.log(`[1] paused=${proxy.pipeline.paused} — subprocess alive: ${proxy.running}`);

  // Send 3 pings during the pause
  for (let i = 1; i <= 3; i++) {
    proxy.writeClientMessage({ jsonrpc: '2.0', id: i, method: 'ping' });
  }
  await sleep(400);
  const q = proxy.pipeline.queueLengths();
  const c2sDuringPause = entries.filter((e) => e.dir === 'c2s').length;
  const responsesDuringPause = entries.filter((e) => e.kind === 'response').length;
  console.log(`[2] paused: queue c2s=${q.c2s} s2c=${q.s2c}, entries c2s=${c2sDuringPause}, responses=${responsesDuringPause} (must be 0/0 — nothing delivered)`);

  // ——— RESUME ———
  proxy.pipeline.resume();
  await sleep(600);
  const ids = entries.filter((e) => e.kind === 'response').map((e) => e.rpcId);
  console.log(`[3] after resume: paused=${proxy.pipeline.paused}, queue=${JSON.stringify(proxy.pipeline.queueLengths())}`);
  console.log(`[4] responses delivered in order: ${JSON.stringify(ids)} (expected [1,2,3])`);

  // Verifications
  const checks: [string, boolean][] = [
    ['subprocess stays alive during the pause', proxy.running === true],
    ['queue accumulated the 3 pings', q.c2s === 3 && q.s2c === 0],
    ['nothing delivered during the pause (c2s log=0, responses=0)', c2sDuringPause === 0 && responsesDuringPause === 0],
    ['resume released EVERYTHING in FIFO order', JSON.stringify(ids) === JSON.stringify([1, 2, 3])],
    ['after resume the queue is empty', proxy.pipeline.queueLengths().c2s === 0],
    ['subprocess stays alive after resume', proxy.running === true],
  ];
  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failed++;
  }

  // Pause again and stop — the queue is released with flushAll
  proxy.pipeline.pause();
  proxy.writeClientMessage({ jsonrpc: '2.0', id: 99, method: 'ping' });
  await sleep(100);
  await proxy.pipeline.flushAll();
  await proxy.stop();
  console.log(failed === 0 ? '\n✅ PAUSE E2E OK' : `\n❌ ${failed} checks failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();