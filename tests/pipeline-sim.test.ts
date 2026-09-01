/**
 * Phase 7 — Simulación (fault injection / auto-mock / throttling).
 *
 * Contratos verificados:
 * - Regla con simulation.type='hold' (o sin simulation) → comportamiento
 *   Phase 6 exacto (hold + FIFO + resolución del usuario).
 * - fault c2s: el request se descarta (msg=null) y se genera una respuesta
 *   sintética con error JSON-RPC para el cliente (syntheticResponse).
 * - fault s2c: la respuesta real se REEMPLAZA por el error (modified).
 * - mock c2s/s2c: igual que fault pero con el payload del usuario.
 * - throttle: el original se entrega tras throttleMs (heldMs refleja el delay).
 * - Notifications (sin id) con fault/mock: drop puro, sin respuesta sintética.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MITMPipeline } from '../src/main/pipeline';
import { JsonRpcMessage, JsonRpcResponse } from '../src/shared/types';

const req = (id: number | string, method: string, params?: unknown): JsonRpcMessage => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

const notif = (method: string): JsonRpcMessage => ({ jsonrpc: '2.0', method });

const resp = (id: number | string, result: unknown): JsonRpcMessage => ({
  jsonrpc: '2.0',
  id,
  result,
});

function isResponse(m: JsonRpcMessage | null): m is JsonRpcResponse {
  return m !== null && !('method' in m) && ('result' in m || 'error' in m);
}

// ——— hold clásico intacto (regresión) ————————————————————————————

test('regla sin simulation sigue siendo hold clásico (Phase 6)', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'tools/call');
  let heldFired = false;
  p.on('held', () => { heldFired = true; });

  const pr = p.process('c2s', req(1, 'tools/call'));
  const r = await Promise.race([pr.then(() => 'resolved'), new Promise((res) => setTimeout(() => res('pending'), 20))]);
  assert.equal(r, 'pending', 'debe quedar retenido');
  assert.equal(heldFired, true);
  assert.equal(p.hasHeld, true);

  p.resolveHold(p.listHeld()[0]!.id, { action: 'send' });
  const out = await pr;
  assert.deepEqual(out.msg, req(1, 'tools/call'));
  assert.equal(out.held, true);
  assert.equal(out.simulated, undefined);
});

test('regla con simulation {type:"hold"} explícito también retiene', async () => {
  const p = new MITMPipeline();
  p.addRule('s2c', '', { type: 'hold' });
  const pr = p.process('s2c', resp(2, { ok: true }));
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(p.hasHeld, true);
  p.resolveHold(p.listHeld()[0]!.id, { action: 'send' });
  const out = await pr;
  assert.equal(out.held, true);
  assert.equal(out.simulated, undefined);
});

// ——— fault injection ——————————————————————————————————————————

test('fault c2s: descarta el request y genera respuesta de error para el cliente', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'tools/call', { type: 'fault', faultCode: -32601, faultMessage: 'no existe' });

  const out = await p.process('c2s', req(7, 'tools/call', { a: 1 }));
  assert.equal(out.msg, null, 'el request nunca llega al server');
  assert.equal(out.simulated, 'fault');
  assert.equal(out.modified, true);
  assert.ok(out.syntheticResponse, 'debe llevar respuesta sintética');
  assert.ok(isResponse(out.syntheticResponse!));
  assert.equal((out.syntheticResponse as JsonRpcResponse).id, 7, 'correlaciona por id');
  assert.deepEqual((out.syntheticResponse as JsonRpcResponse).error, { code: -32601, message: 'no existe' });
  assert.equal(p.hasHeld, false, 'no queda en hold — es automático');
});

test('fault c2s usa defaults (-32603) si no se configuran', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', '', { type: 'fault' });
  const out = await p.process('c2s', req(9, 'ping'));
  assert.deepEqual((out.syntheticResponse as JsonRpcResponse).error, { code: -32603, message: 'Injected fault (mcp-inspect)' });
});

test('fault s2c: reemplaza la respuesta real por el error', async () => {
  const p = new MITMPipeline();
  // correlación: primero observamos el request c2s (sin regla)
  await p.process('c2s', req(3, 'tools/list'));
  p.addRule('s2c', 'tools/list', { type: 'fault', faultCode: -32602 });

  const out = await p.process('s2c', resp(3, { tools: [] }));
  assert.notEqual(out.msg, null);
  assert.equal(out.simulated, 'fault');
  assert.equal(out.modified, true);
  assert.ok(isResponse(out.msg!));
  assert.equal((out.msg as JsonRpcResponse).error?.code, -32602);
  assert.equal((out.msg as JsonRpcResponse).error?.message, 'Injected fault (mcp-inspect)');
  assert.equal(out.syntheticResponse, undefined, 's2c reemplaza en el mismo mensaje, no genera extra');
});

test('fault sobre notification: drop puro, sin respuesta sintética', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', '', { type: 'fault' });
  const out = await p.process('c2s', notif('notifications/initialized'));
  assert.equal(out.msg, null);
  assert.equal(out.syntheticResponse, undefined);
  assert.equal(out.simulated, 'fault');
});

test('fault sobre request iniciado por el SERVER (s2c): drop puro', async () => {
  const p = new MITMPipeline();
  p.addRule('s2c', '', { type: 'fault' });
  // sampling/createMessage: request del server hacia el cliente (method + id, s2c)
  const out = await p.process('s2c', req(50, 'sampling/createMessage'));
  assert.equal(out.msg, null, 'no debe entregarse al cliente');
  assert.equal(out.syntheticResponse, undefined, 'reemplazarlo con una response confundiría al cliente');
  assert.equal(out.simulated, 'fault');
});

// ——— auto-mock ———————————————————————————————————————————————————

test('mock c2s: entrega mockResult como result al cliente', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'tools/call', { type: 'mock', mockResult: { content: [{ type: 'text', text: 'mocked!' }] } });

  const out = await p.process('c2s', req(11, 'tools/call', { name: 'echo' }));
  assert.equal(out.msg, null);
  assert.equal(out.simulated, 'mock');
  assert.ok(isResponse(out.syntheticResponse!));
  assert.deepEqual((out.syntheticResponse as JsonRpcResponse).result, { content: [{ type: 'text', text: 'mocked!' }] });
  assert.equal((out.syntheticResponse as JsonRpcResponse).error, undefined);
});

test('mock con mockError entrega error', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'ping', { type: 'mock', mockError: { code: -32000, message: 'mock err' } });
  const out = await p.process('c2s', req(12, 'ping'));
  assert.deepEqual((out.syntheticResponse as JsonRpcResponse).error, { code: -32000, message: 'mock err' });
});

test('mock s2c: reemplaza la respuesta real por mockResult', async () => {
  const p = new MITMPipeline();
  await p.process('c2s', req(13, 'resources/list'));
  p.addRule('s2c', 'resources/list', { type: 'mock', mockResult: { resources: [{ uri: 'mock://x', name: 'x' }] } });

  const out = await p.process('s2c', resp(13, { resources: [] }));
  assert.ok(isResponse(out.msg!));
  assert.deepEqual((out.msg as JsonRpcResponse).result, { resources: [{ uri: 'mock://x', name: 'x' }] });
  assert.equal(out.simulated, 'mock');
  assert.equal(out.modified, true);
});

// ——— throttling —————————————————————————————————————————————————

test('throttle: entrega el original tras el delay', async () => {
  const p = new MITMPipeline();
  p.addRule('s2c', '', { type: 'throttle', throttleMs: 60 });

  const t0 = Date.now();
  const out = await p.process('s2c', notif('notifications/message'));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 55, `debe tardar >=55ms, tardó ${elapsed}ms`);
  assert.deepEqual(out.msg, notif('notifications/message'), 'el original fluye intacto');
  assert.equal(out.simulated, 'throttle');
  assert.equal(out.held, false);
  assert.equal(out.modified, false);
  assert.ok(out.heldMs >= 55, `heldMs debe reflejar el delay (${out.heldMs})`);
});

test('throttle 0ms resuelve inmediato', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'ping', { type: 'throttle', throttleMs: 0 });
  const out = await p.process('c2s', req(1, 'ping'));
  assert.equal(out.simulated, 'throttle');
  assert.deepEqual(out.msg, req(1, 'ping'));
});

// ——— reglas desactivadas / interacción ——————————————————————————

test('regla con simulation desactivada no aplica', async () => {
  const p = new MITMPipeline();
  const rule = p.addRule('c2s', 'tools/call', { type: 'fault' });
  p.toggleRule(rule.id, false);
  const out = await p.process('c2s', req(5, 'tools/call'));
  assert.deepEqual(out.msg, req(5, 'tools/call'));
  assert.equal(out.simulated, undefined);
});

test('setRuleSimulation cambia una regla de hold a fault', async () => {
  const p = new MITMPipeline();
  const rule = p.addRule('c2s', 'ping');
  p.setRuleSimulation(rule.id, { type: 'fault', faultCode: -32601 });
  const out = await p.process('c2s', req(6, 'ping'));
  assert.equal(out.msg, null);
  assert.equal((out.syntheticResponse as JsonRpcResponse).error?.code, -32601);
  assert.equal(out.simulated, 'fault');
});

test('setRuleSimulation(null) devuelve la regla a hold clásico', async () => {
  const p = new MITMPipeline();
  const rule = p.addRule('c2s', 'ping', { type: 'fault' });
  p.setRuleSimulation(rule.id, null);
  const pr = p.process('c2s', req(6, 'ping'));
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(p.hasHeld, true, 'debe retener de nuevo');
  p.resolveHold(p.listHeld()[0]!.id, { action: 'send' });
  const out = await pr;
  assert.equal(out.held, true);
});

test('flushAll limpia reglas de simulación y no deja holds', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'tools/call', { type: 'fault' });
  await p.flushAll();
  const out = await p.process('c2s', req(99, 'tools/call'));
  assert.deepEqual(out.msg, req(99, 'tools/call'));
  assert.equal(out.simulated, undefined);
});

test('la correlación sigue viva tras un fault c2s (latencia medible)', async () => {
  const p = new MITMPipeline();
  const out = await p.process('c2s', req(21, 'tools/call')); // sin reglas: fluye + se observa
  assert.ok(out.msg);
  p.addRule('s2c', 'tools/call', { type: 'fault' });
  const out2 = await p.process('s2c', resp(21, { ok: 1 }));
  assert.equal((out2.msg as JsonRpcResponse).error?.code, -32603);
});