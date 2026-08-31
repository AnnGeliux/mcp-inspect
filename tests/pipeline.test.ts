/**
 * Tests del MITM Pipeline (Phase 6).
 *
 * Run with: node --test --import tsx tests/pipeline.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MITMPipeline } from '../src/main/pipeline';
import { JsonRpcMessage } from '../src/shared/types';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const INIT: JsonRpcMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
};

const PING: JsonRpcMessage = { jsonrpc: '2.0', id: 2, method: 'ping' };

const PING_RESP: JsonRpcMessage = { jsonrpc: '2.0', id: 2, result: {} };

// ——— Sin reglas: flujo inmediato ——————————————————————————

test('pipeline: sin reglas, el mensaje fluye tal cual (inmediato)', async () => {
  const p = new MITMPipeline();
  const r = await p.process('c2s', INIT);
  assert.equal(r.held, false);
  assert.equal(r.modified, false);
  assert.equal(r.msg, INIT);
  assert.equal(p.hasHeld, false);
});

test('pipeline: process resuelve inmediatamente sin reglas (no deja promesas colgando)', async () => {
  const p = new MITMPipeline();
  const r = await p.process('s2c', PING_RESP);
  assert.equal(r.msg, PING_RESP);
});

// ——— Reglas ———————————————————————————————————————————————————

test('pipeline: addRule + coincidencia por método retiene el mensaje', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'tools/call');

  const promise = p.process('c2s', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo' } });
  // Aún no resuelto: el hold está registrado
  assert.equal(p.hasHeld, true);
  const held = p.listHeld();
  assert.equal(held.length, 1);
  assert.equal(held[0]!.dir, 'c2s');

  // Resolver con send → entrega original
  const ok = p.resolveHold(held[0]!.id, { action: 'send' });
  assert.equal(ok, true);
  const r = await promise;
  assert.equal(r.held, true);
  assert.equal(r.modified, false);
  assert.deepEqual(r.msg, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo' } });
});

test('pipeline: regla por método no retiene otros métodos', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'tools/call');
  const r = await p.process('c2s', PING);
  assert.equal(r.held, false, 'ping no debe ser retenido por regla tools/call');
});

test('pipeline: regla deshabilitada no retiene', async () => {
  const p = new MITMPipeline();
  const rule = p.addRule('c2s', 'ping');
  p.toggleRule(rule.id, false);
  const r = await p.process('c2s', PING);
  assert.equal(r.held, false);
});

test('pipeline: removeRule elimina la retención', async () => {
  const p = new MITMPipeline();
  const rule = p.addRule('c2s', 'ping');
  p.removeRule(rule.id);
  const r = await p.process('c2s', PING);
  assert.equal(r.held, false);
});

test('pipeline: intercept-all retiene todo en esa dirección', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('s2c', true);
  const promise = p.process('s2c', PING_RESP);
  assert.equal(p.hasHeld, true);
  const held = p.listHeld();
  p.resolveHold(held[0]!.id, { action: 'send' });
  const r = await promise;
  assert.equal(r.held, true);
  // intercept-all solo aplica a s2c: c2s sigue fluyendo
  const r2 = await p.process('c2s', PING);
  assert.equal(r2.held, false);
});

// ——— Resoluciones ————————————————————————————————————————

test('pipeline: send-modified entrega el mensaje editado', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('c2s', true);
  const promise = p.process('c2s', PING);
  const held = p.listHeld();
  const edited: JsonRpcMessage = { jsonrpc: '2.0', id: 2, method: 'ping', params: { extra: true } };
  p.resolveHold(held[0]!.id, { action: 'send-modified', msg: edited });
  const r = await promise;
  assert.equal(r.held, true);
  assert.equal(r.modified, true);
  assert.deepEqual(r.msg, edited);
});

test('pipeline: drop descarta el mensaje (msg null)', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('c2s', true);
  const promise = p.process('c2s', PING);
  const held = p.listHeld();
  p.resolveHold(held[0]!.id, { action: 'drop' });
  const r = await promise;
  assert.equal(r.msg, null);
  assert.equal(r.held, true);
});

test('pipeline: respond en s2c entrega la respuesta sintética', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('s2c', true);
  const promise = p.process('s2c', PING_RESP);
  const held = p.listHeld();
  const synthetic: JsonRpcMessage = { jsonrpc: '2.0', id: 2, result: { fake: true } };
  p.resolveHold(held[0]!.id, { action: 'respond', msg: synthetic });
  const r = await promise;
  assert.deepEqual(r.msg, synthetic);
  assert.equal(r.modified, true);
});

test('pipeline: respond en c2s equivale a drop', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('c2s', true);
  const promise = p.process('c2s', PING);
  const held = p.listHeld();
  p.resolveHold(held[0]!.id, { action: 'respond', msg: { jsonrpc: '2.0', id: 2, result: {} } });
  const r = await promise;
  assert.equal(r.msg, null);
});

test('pipeline: resolveHold con id desconocido devuelve false', () => {
  const p = new MITMPipeline();
  assert.equal(p.resolveHold('nope', { action: 'send' }), false);
});

// ——— FIFO: orden nunca se reordena ————————————————————————

test('pipeline: resolver el segundo hold primero NO lo entrega antes que el primero', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('c2s', true);

  const p1 = p.process('c2s', { jsonrpc: '2.0', id: 10, method: 'ping' });
  const p2 = p.process('c2s', { jsonrpc: '2.0', id: 11, method: 'ping' });
  await sleep(0);
  assert.equal(p.listHeld().length, 2);

  const [h1, h2] = p.listHeld();

  // Resolver el SEGUNDO primero
  p.resolveHold(h2!.id, { action: 'send' });
  await sleep(10);
  // p2 NO debe estar resuelto todavía (está detrás de h1)
  let resolved2 = false;
  p2.then(() => { resolved2 = true; });
  await sleep(10);
  assert.equal(resolved2, false, 'p2 no debe entregarse antes que p1 (FIFO)');

  // Ahora resolver el primero → cascada libera el segundo
  p.resolveHold(h1!.id, { action: 'send' });
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.held, true);
  assert.equal(r2.held, true);
  assert.deepEqual((r2.msg as { id: number }).id, 11);
});

test('pipeline: cascada con decisiones mixtas (drop en cola) se aplica en orden', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('c2s', true);

  const p1 = p.process('c2s', { jsonrpc: '2.0', id: 20, method: 'ping' });
  const p2 = p.process('c2s', { jsonrpc: '2.0', id: 21, method: 'ping' });
  await sleep(0);
  const [h1, h2] = p.listHeld();

  // El usuario decide drop para el 2do y send para el 1ro
  p.resolveHold(h2!.id, { action: 'drop' });
  p.resolveHold(h1!.id, { action: 'send' });

  const r1 = await p1;
  const r2 = await p2;
  assert.deepEqual((r1.msg as { id: number }).id, 20, 'primero entregado');
  assert.equal(r2.msg, null, 'segundo dropeado');
});

// ——— Correlación id→method (latencia) ————————————————————

test('pipeline: correlación de respuesta por id devuelve método y latencia', async () => {
  const p = new MITMPipeline();
  const start = Date.now();
  await p.process('c2s', PING); // observa id=2 → ping
  await sleep(30);
  const corr = p.correlateResponse('s2c', PING_RESP);
  assert.ok(corr, 'debe correlacionar la respuesta id=2 con ping');
  assert.equal(corr!.requestMethod, 'ping');
  assert.ok(corr!.latencyMs >= 25, `latencia ≥ 25ms (got ${corr!.latencyMs})`);
  assert.ok(Date.now() - start >= 25);
});

test('pipeline: correlación consume el id (segunda respuesta con mismo id → null)', () => {
  const p = new MITMPipeline();
  void p.process('c2s', PING);
  const c1 = p.correlateResponse('s2c', PING_RESP);
  assert.ok(c1);
  const c2 = p.correlateResponse('s2c', PING_RESP);
  assert.equal(c2, null);
});

test('pipeline: respuesta sin id correlacionado → null', () => {
  const p = new MITMPipeline();
  const corr = p.correlateResponse('s2c', { jsonrpc: '2.0', id: 999, result: {} });
  assert.equal(corr, null);
});

test('pipeline: reglas s2c por método usan la correlación (responses no llevan method)', async () => {
  const p = new MITMPipeline();
  // Regla para respuestas de ping
  p.addRule('s2c', 'ping');
  // Request c2s ping observado
  await p.process('c2s', PING);
  // La respuesta (sin method) debe ser retenida por la regla 'ping'
  const promise = p.process('s2c', PING_RESP);
  assert.equal(p.hasHeld, true, 'la respuesta de ping debe ser retenida');
  const held = p.listHeld();
  p.resolveHold(held[0]!.id, { action: 'send' });
  await promise;
});

// ——— flushAll / clear ————————————————————————————————————

test('pipeline: flushAll envía los originales y limpia reglas', async () => {
  const p = new MITMPipeline();
  p.setInterceptAll('c2s', true);
  p.addRule('s2c', 'ping');

  const p1 = p.process('c2s', PING);
  await sleep(0);
  assert.equal(p.hasHeld, true);

  await p.flushAll();
  const r = await p1;
  assert.equal(r.held, true);
  assert.deepEqual(r.msg, PING);
  assert.equal(p.hasHeld, false);
  assert.equal(p.listRules().length, 0);
  assert.equal(p.getInterceptAll('c2s'), false);
  assert.equal(p.getInterceptAll('s2c'), false);
});

test('pipeline: clearCorrelation limpia los mapas de correlación', () => {
  const p = new MITMPipeline();
  void p.process('c2s', PING);
  p.clearCorrelation();
  const corr = p.correlateResponse('s2c', PING_RESP);
  assert.equal(corr, null);
});

// ——— Eventos ————————————————————————————————————————————————

test('pipeline: emite held/released/rulesChanged', async () => {
  const p = new MITMPipeline();
  let heldCount = 0;
  let releasedCount = 0;
  let rulesCount = 0;
  p.on('held', () => heldCount++);
  p.on('released', () => releasedCount++);
  p.on('rulesChanged', () => rulesCount++);

  p.addRule('c2s', 'ping'); // rulesChanged #1
  const promise = p.process('c2s', PING); // held #1
  await sleep(0); // held se emite sincrónicamente en process(), pero esperamos el tick
  const [held] = p.listHeld();
  p.resolveHold(held!.id, { action: 'send' }); // released #1
  await promise;

  assert.equal(heldCount, 1);
  assert.equal(releasedCount, 1);
  // addRule emite rulesChanged; resolver el head emite 'released' (no rulesChanged)
  assert.equal(rulesCount, 1);
});

// ——— Pausa global (congelar tráfico sin matar el subprocess) ———

test('pipeline: pause encola el mensaje, resume lo entrega en orden', async () => {
  const p = new MITMPipeline();
  p.pause();

  const p1 = p.process('c2s', { jsonrpc: '2.0', id: 30, method: 'ping' });
  const p2 = p.process('c2s', { jsonrpc: '2.0', id: 31, method: 'ping' });

  // Aún encolados: ninguna promesa resuelta
  let resolved1 = false;
  let resolved2 = false;
  p1.then(() => { resolved1 = true; });
  p2.then(() => { resolved2 = true; });
  await sleep(10);
  assert.equal(resolved1, false, 'p1 en cola, no entregado');
  assert.equal(resolved2, false, 'p2 en cola, no entregado');
  assert.equal(p.queueLengths().c2s, 2);

  p.resume();
  const r1 = await p1;
  const r2 = await p2;
  assert.ok(r1.msg, 'p1 entregado');
  assert.ok(r2.msg, 'p2 entregado');
  assert.deepEqual((r1.msg as { id: number }).id, 30, 'FIFO: p1 primero');
  assert.deepEqual((r2.msg as { id: number }).id, 31, 'FIFO: p2 segundo');
  assert.equal(r1.held, false, 'la pausa no es un hold');
  assert.equal(p.queueLengths().c2s, 0);
});

test('pipeline: en pausa, el flujo con reglas no retiene — la cola gana', async () => {
  const p = new MITMPipeline();
  p.addRule('c2s', 'ping'); // regla activa
  p.pause();

  const promise = p.process('c2s', PING);
  await sleep(10);
  assert.equal(p.hasHeld, false, 'la pausa encola antes de evaluar reglas');
  assert.equal(p.queueLengths().c2s, 1);

  // resume: el mensaje re-entra al pipeline → ahora sí lo retiene la regla
  p.resume();
  await sleep(10);
  assert.equal(p.hasHeld, true, 'tras resume, la regla retiene el mensaje encolado');
  const held = p.listHeld();
  p.resolveHold(held[0]!.id, { action: 'send' });
  const r = await promise;
  assert.equal(r.held, true);
});

test('pipeline: pause/resume emite pausedChanged', async () => {
  const p = new MITMPipeline();
  const events: boolean[] = [];
  p.on('pausedChanged', (v) => events.push(v));
  p.pause();
  p.pause(); // idempotente — no debe emitir de nuevo
  p.resume();
  p.resume(); // idempotente
  assert.deepEqual(events, [true, false]);
});

test('pipeline: flushAll con pausa activa libera la cola con originales', async () => {
  const p = new MITMPipeline();
  p.pause();
  const promise = p.process('c2s', PING);
  assert.equal(p.queueLengths().c2s, 1);

  await p.flushAll();
  const r = await promise;
  assert.ok(r.msg, 'flushAll entrega el original');
  assert.deepEqual(r.msg, PING);
  assert.equal(p.paused, false);
  assert.equal(p.queueLengths().c2s, 0);
});

test('pipeline: resetPause descarta la cola vieja (drop)', async () => {
  const p = new MITMPipeline();
  p.pause();
  const promise = p.process('c2s', PING);
  p.resetPause();
  const r = await promise;
  assert.equal(r.msg, null, 'resetPause dropea los mensajes de la sesión vieja');
  assert.equal(p.paused, false);
});

test('pipeline: pausa no rompe la correlación id→method tras resume', async () => {
  const p = new MITMPipeline();
  p.pause();
  const reqPromise = p.process('c2s', PING);
  const respPromise = p.process('s2c', PING_RESP);
  await sleep(10);
  p.resume();
  await reqPromise;
  await respPromise;

  // El request fue observado (c2s se drena primero) → la respuesta correlaciona
  const corr = p.correlateResponse('s2c', PING_RESP);
  assert.ok(corr, 'la correlación sobrevive a la pausa (request observado antes)');
  assert.equal(corr!.requestMethod, 'ping');
});