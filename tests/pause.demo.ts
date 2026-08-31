/**
 * Demo e2e: pausa MITM con un subprocess real.
 * Verifica que pause() NO mata el proceso, encola el tráfico,
 * y que resume() lo libera en orden FIFO.
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

  // echo server (preset del inspector): responde {ok:true} a cada request
  proxy.start({
    command: 'node',
    args: ['-e', "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>{for(const line of d.trim().split('\\n')){const m=JSON.parse(line);if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ok:true}}));}});"],
    connectClient: false,
  } as never);
  await sleep(300);

  // ——— PAUSA ———
  proxy.pipeline.pause();
  console.log(`[1] paused=${proxy.pipeline.paused} — subprocess vivo: ${proxy.running}`);

  // Enviar 3 pings durante la pausa
  for (let i = 1; i <= 3; i++) {
    proxy.writeClientMessage({ jsonrpc: '2.0', id: i, method: 'ping' });
  }
  await sleep(400);
  const q = proxy.pipeline.queueLengths();
  const c2sDuringPause = entries.filter((e) => e.dir === 'c2s').length;
  const responsesDuringPause = entries.filter((e) => e.kind === 'response').length;
  console.log(`[2] en pausa: cola c2s=${q.c2s} s2c=${q.s2c}, entries c2s=${c2sDuringPause}, responses=${responsesDuringPause} (deben ser 0/0 — nada entregado)`);

  // ——— RESUME ———
  proxy.pipeline.resume();
  await sleep(600);
  const ids = entries.filter((e) => e.kind === 'response').map((e) => e.rpcId);
  console.log(`[3] tras resume: paused=${proxy.pipeline.paused}, cola=${JSON.stringify(proxy.pipeline.queueLengths())}`);
  console.log(`[4] responses entregadas en orden: ${JSON.stringify(ids)} (esperado [1,2,3])`);

  // Verificaciones
  const checks: [string, boolean][] = [
    ['subprocess sigue vivo durante la pausa', proxy.running === true],
    ['cola acumuló los 3 pings', q.c2s === 3 && q.s2c === 0],
    ['nada entregado durante la pausa (c2s log=0, responses=0)', c2sDuringPause === 0 && responsesDuringPause === 0],
    ['resume liberó TODO en orden FIFO', JSON.stringify(ids) === JSON.stringify([1, 2, 3])],
    ['tras resume la cola quedó vacía', proxy.pipeline.queueLengths().c2s === 0],
    ['subprocess sigue vivo tras el resume', proxy.running === true],
  ];
  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failed++;
  }

  // Pausar de nuevo y hacer stop — la cola se libera con flushAll
  proxy.pipeline.pause();
  proxy.writeClientMessage({ jsonrpc: '2.0', id: 99, method: 'ping' });
  await sleep(100);
  await proxy.pipeline.flushAll();
  await proxy.stop();
  console.log(failed === 0 ? '\n✅ PAUSA E2E OK' : `\n❌ ${failed} checks fallaron`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();