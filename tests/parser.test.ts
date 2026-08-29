/**
 * Tests del parser NDJSON. Ejecutar con: npm test
 *
 * Spec MCP: "Messages are delimited by newlines, and MUST NOT contain embedded newlines."
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NdjsonParser, parseLine } from '../src/main/parser';

test('parseLine: request válido', () => {
  const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { a: 1 } });
  const r = parseLine(line);
  assert.ok(r);
  assert.equal(r!.method, 'initialize');
  assert.equal((r as any).id, 1);
});

test('parseLine: notification válido (sin id)', () => {
  const line = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const r = parseLine(line);
  assert.ok(r);
  assert.equal(r!.method, 'notifications/initialized');
});

test('parseLine: response válido', () => {
  const line = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { ok: true } });
  const r = parseLine(line);
  assert.ok(r);
  assert.equal((r as any).id, 2);
  assert.deepEqual((r as any).result, { ok: true });
});

test('parseLine: error válido', () => {
  const line = JSON.stringify({ jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Method not found' } });
  const r = parseLine(line);
  assert.ok(r);
  assert.equal((r as any).error.code, -32601);
});

test('parseLine: línea vacía devuelve null', () => {
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('   '), null);
});

test('parseLine: JSON inválido devuelve null (no inventa)', () => {
  assert.equal(parseLine('{not json'), null);
  assert.equal(parseLine('"a string"'), null); // JSON válido pero no es objeto
});

test('parseLine: jsonrpc incorrecto devuelve null', () => {
  assert.equal(parseLine(JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'x' })), null);
});

test('NdjsonParser: feed con múltiples líneas en un chunk', () => {
  const p = new NdjsonParser();
  const msg1 = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const msg2 = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } });
  const out = p.feed(msg1 + '\n' + msg2 + '\n');
  assert.equal(out.length, 2);
  assert.equal(out[0]!.method, 'tools/list');
  assert.equal(out[1]!.method, 'tools/call');
});

test('NdjsonParser: feed incremental (línea llega partida)', () => {
  const p = new NdjsonParser();
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  // Cortamos en el medio
  const half = Math.floor(msg.length / 2);
  const out1 = p.feed(msg.slice(0, half));
  assert.equal(out1.length, 0); // aún incompleta
  assert.equal(p.pending, msg.slice(0, half));
  const out2 = p.feed(msg.slice(half) + '\n');
  assert.equal(out2.length, 1);
  assert.equal(out2[0]!.method, 'ping');
  assert.equal(p.pending, '');
});

test('NdjsonParser: feed tolera CRLF', () => {
  const p = new NdjsonParser();
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  const out = p.feed(msg + '\r\n');
  assert.equal(out.length, 1);
  assert.equal(out[0]!.method, 'ping');
});

test('NdjsonParser: flush procesa última línea sin newline', () => {
  const p = new NdjsonParser();
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  p.feed(msg);
  assert.equal(p.pending, msg);
  const out = p.flush();
  assert.equal(out.length, 1);
  assert.equal(out[0]!.method, 'ping');
});

test('NdjsonParser: líneas vacías se ignoran', () => {
  const p = new NdjsonParser();
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  const out = p.feed('\n' + msg + '\n\n');
  assert.equal(out.length, 1);
});

test('NdjsonParser: flujo realista de initialize handshake', () => {
  const p = new NdjsonParser();
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  const initResp = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '0.0.1' } } });
  const initialized = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const out = p.feed(init + '\n' + initResp + '\n' + initialized + '\n');
  assert.equal(out.length, 3);
  assert.equal(out[0]!.method, 'initialize');
  assert.equal((out[1] as any).result.serverInfo.name, 'test');
  assert.equal(out[2]!.method, 'notifications/initialized');
  // El notification no debe tener id
  assert.equal('id' in out[2]!, false);
});
