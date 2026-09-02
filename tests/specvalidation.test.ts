/**
 * MCP spec validation tests (Phase 5).
 *
 * Run with: node --test --import tsx tests/specvalidation.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec } from '../src/main/specValidation';
import { JsonRpcMessage } from '../src/shared/types';

const initReq: JsonRpcMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: { roots: {} },
    clientInfo: { name: 'mcp-inspector', version: '0.1.0' },
  },
};

// ——— Valid requests ———————————————————————————————————————

test('spec: initialize válido pasa', () => {
  const r = validateSpec(initReq);
  assert.ok(r, 'should validate');
  assert.equal(r!.ok, true);
});

test('spec: ping válido pasa', () => {
  const r = validateSpec({ jsonrpc: '2.0', id: 2, method: 'ping' });
  assert.ok(r);
  assert.equal(r!.ok, true);
});

test('spec: tools/call válido pasa', () => {
  const r = validateSpec({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'echo', arguments: { message: 'hello' } },
  });
  assert.ok(r);
  assert.equal(r!.ok, true);
});

test('spec: notification initialized válida pasa', () => {
  const r = validateSpec({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.ok(r);
  assert.equal(r!.ok, true);
});

// ——— Invalid requests ————————————————————————————————————

test('spec: initialize sin protocolVersion falla', () => {
  const r = validateSpec({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { capabilities: {}, clientInfo: { name: 'x', version: '0' } },
  });
  assert.ok(r);
  assert.equal(r!.ok, false, 'protocolVersion is required by the spec');
  assert.ok(r!.issues, 'must describe the issue');
});

test('spec: tools/call sin name falla', () => {
  const r = validateSpec({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { arguments: {} },
  });
  assert.ok(r);
  assert.equal(r!.ok, false, 'name is required in tools/call');
});

test('spec: initialize con clientInfo incompleto falla', () => {
  const r = validateSpec({
    jsonrpc: '2.0',
    id: 5,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x' } },
  });
  assert.ok(r);
  assert.equal(r!.ok, false, 'clientInfo.version is required');
});

// ——— Responses ————————————————————————————————————————————

test('spec: response de ping correlacionada valida contra EmptyResult', () => {
  const r = validateSpec({ jsonrpc: '2.0', id: 2, result: {} }, 'ping');
  assert.ok(r);
  assert.equal(r!.ok, true);
});

test('spec: response de tools/list con tools[] válida', () => {
  const r = validateSpec(
    {
      jsonrpc: '2.0',
      id: 3,
      result: {
        tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }],
      },
    },
    'tools/list',
  );
  assert.ok(r);
  assert.equal(r!.ok, true);
});

test('spec: response de tools/list SIN tools[] falla', () => {
  const r = validateSpec({ jsonrpc: '2.0', id: 3, result: { nope: true } }, 'tools/list');
  assert.ok(r);
  assert.equal(r!.ok, false, 'tools is required in ListToolsResult');
});

test('spec: response sin requestMethod → framing genérico', () => {
  const r = validateSpec({ jsonrpc: '2.0', id: 3, result: { anything: true } });
  assert.ok(r);
  assert.equal(r!.ok, true, 'without correlation only base framing is validated');
});

// ——— Unknown methods ———————————————————————————————————————

test('spec: método custom desconocido valida contra framing base', () => {
  const r = validateSpec({ jsonrpc: '2.0', id: 9, method: 'custom/experimental', params: { x: 1 } });
  assert.ok(r);
  assert.equal(r!.ok, true, 'custom methods pass the generic framing');
});

test('spec: mensaje que no es JSON-RPC falla el framing', () => {
  const r = validateSpec({ random: 'garbage' } as unknown as JsonRpcMessage);
  assert.ok(r);
  assert.equal(r!.ok, false);
});

// ——— Notifications ————————————————————————————————————————

test('spec: notification progress válida', () => {
  const r = validateSpec({
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { progressToken: 't1', progress: 1, total: 10 },
  });
  assert.ok(r);
  assert.equal(r!.ok, true);
});

test('spec: notification progress sin progressToken falla', () => {
  const r = validateSpec({
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { progress: 1 },
  });
  assert.ok(r);
  assert.equal(r!.ok, false, 'progressToken is required');
});

test('spec: notifications/cancelled válida', () => {
  const r = validateSpec({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 42, reason: 'user asked' },
  });
  assert.ok(r);
  assert.equal(r!.ok, true);
});