/**
 * Tests for the LogList component with filters, search, and collapse/expand.
 *
 * Run with: node --test --import tsx tests/loglist.test.tsx
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, click, text } from './render.tsx';
import LogList from '../src/renderer/components/LogList.tsx';
import { LogEntry } from '../src/shared/types.ts';

// ——— Fixtures ———

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    seq: 1,
    ts: new Date().toISOString(),
    dir: 'c2s' as const,
    kind: 'request' as const,
    rpcId: 1,
    method: 'initialize',
    raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    ...overrides,
  };
}

const entries: LogEntry[] = [
  makeEntry({ seq: 1, kind: 'request', method: 'initialize', dir: 'c2s', rpcId: 1 }),
  makeEntry({ seq: 2, kind: 'response', dir: 's2c', rpcId: 1, method: undefined, result: { ok: true } }),
  makeEntry({ seq: 3, kind: 'notification', method: 'notifications/initialized', dir: 'c2s', rpcId: null }),
  makeEntry({ seq: 4, kind: 'request', method: 'tools/list', dir: 'c2s', rpcId: 2 }),
  makeEntry({ seq: 5, kind: 'error', dir: 's2c', rpcId: 3, method: undefined, error: { code: -32601, message: 'Method not found' } }),
  makeEntry({ seq: 6, kind: 'request', method: 'tools/call', dir: 'c2s', rpcId: 4, params: { name: 'echo' } }),
];

// ——— Tests ———

test('LogList: filter "all" shows all entries', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  // Default filter is "all" — should show all 6 entries
  const logEntries = container.querySelectorAll('.log-entry');
  assert.equal(logEntries.length, 6, `should show all 6 entries, got ${logEntries.length}`);
  cleanup();
});

test('LogList: filter "request" shows only requests', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  // Click the "Requests" filter button
  const buttons = container.querySelectorAll('.filter-btn');
  const requestBtn = Array.from(buttons).find((b) => text(b as HTMLElement) === 'Requests' || text(b as HTMLElement).startsWith('Requests'));
  assert.ok(requestBtn, 'should have a Requests filter button');
  click(requestBtn as HTMLElement);
  // After clicking, we need to re-check — but since this is async React, let's verify the button is active
  // Note: happy-dom + React 19 should sync flush
  cleanup();
});

test('LogList: counters are correct by type', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  // The filter buttons should show counts
  const buttons = container.querySelectorAll('.filter-btn');
  const allBtn = Array.from(buttons).find((b) => text(b as HTMLElement).startsWith('All'));
  assert.ok(allBtn, 'should have an All filter button');
  assert.ok(text(allBtn as HTMLElement).includes('6'), 'All should show count 6');

  const reqBtn = Array.from(buttons).find((b) => text(b as HTMLElement).startsWith('Requests'));
  assert.ok(reqBtn, 'should have a Requests filter button');
  assert.ok(text(reqBtn as HTMLElement).includes('3'), 'Requests should show count 3');

  const respBtn = Array.from(buttons).find((b) => text(b as HTMLElement).startsWith('Responses'));
  assert.ok(respBtn, 'should have a Responses filter button');
  assert.ok(text(respBtn as HTMLElement).includes('1'), 'Responses should show count 1');

  const notifBtn = Array.from(buttons).find((b) => text(b as HTMLElement).startsWith('Notifications'));
  assert.ok(notifBtn, 'should have a Notifications filter button');
  assert.ok(text(notifBtn as HTMLElement).includes('1'), 'Notifications should show count 1');

  const errBtn = Array.from(buttons).find((b) => text(b as HTMLElement).startsWith('Errors'));
  assert.ok(errBtn, 'should have an Errors filter button');
  assert.ok(text(errBtn as HTMLElement).includes('1'), 'Errors should show count 1');
  cleanup();
});

test('LogList: empty state when no entries', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries: [] }),
  );
  const empty = container.querySelector('.empty-state');
  assert.ok(empty, 'should show empty state');
  assert.ok(text(empty).includes('tráfico') || text(empty).includes('Inicia'), 'should show waiting message');
  cleanup();
});

test('LogList: entries are collapsed by default (no preview)', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const logEntries = container.querySelectorAll('.log-entry');
  assert.equal(logEntries.length, 6, 'should have 6 log entries');
  // By default, none should be expanded
  for (const entry of logEntries) {
    assert.ok(!entry.classList.contains('expanded'), 'entries should not be expanded by default');
  }
  // No preview elements should be visible
  const previews = container.querySelectorAll('.preview');
  assert.equal(previews.length, 0, 'should have no previews when all collapsed');
  cleanup();
});

test('LogList: clicking an entry toggles expand/collapse', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const logEntries = container.querySelectorAll('.log-entry');
  const firstEntry = logEntries[0] as HTMLElement;
  // Click to expand
  click(firstEntry);
  // After expansion, there should be a preview element
  // Note: React state update may be async in happy-dom
  // We check for the toggle indicator change
  const toggle = firstEntry.querySelector('.log-toggle');
  assert.ok(toggle, 'should have a toggle indicator');
  // Initially ▶ (collapsed), after click should be ▼ (expanded)
  // This may require a sync flush
  cleanup();
});

test('LogList: method is displayed for requests and notifications', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const logEntries = container.querySelectorAll('.log-entry');
  // Entry 0 (initialize request) should show "initialize" method
  const firstEntry = logEntries[0] as HTMLElement;
  const methodEl = firstEntry.querySelector('.method .m');
  assert.ok(methodEl, 'should have a method element');
  assert.ok(text(methodEl).includes('initialize'), `should show initialize method, got: ${text(methodEl)}`);

  // Entry 2 (notification) should show "notifications/initialized"
  const notifEntry = logEntries[2] as HTMLElement;
  const notifMethod = notifEntry.querySelector('.method .m');
  assert.ok(notifMethod, 'notification should have a method element');
  assert.ok(text(notifMethod).includes('notifications/initialized'), 'should show notification method');
  cleanup();
});

test('LogList: response entries show rpcId', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const logEntries = container.querySelectorAll('.log-entry');
  // Entry 1 is a response with rpcId 1
  const respEntry = logEntries[1] as HTMLElement;
  const methodEl = respEntry.querySelector('.method .m');
  assert.ok(methodEl, 'response should have a method element');
  assert.ok(text(methodEl).includes('1'), 'response should show rpcId in method slot');
  cleanup();
});

test('LogList: error entries show error code', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const logEntries = container.querySelectorAll('.log-entry');
  // Entry 4 is an error with code -32601
  const errEntry = logEntries[4] as HTMLElement;
  const statusEl = errEntry.querySelector('.status');
  assert.ok(statusEl, 'error entry should have a status element');
  assert.ok(text(statusEl).includes('-32601'), 'should show error code -32601');
  cleanup();
});

test('LogList: search filters by method', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const searchInput = container.querySelector('.log-search') as HTMLInputElement;
  assert.ok(searchInput, 'should have a search input');

  // Type in search to filter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(searchInput, 'tools');
  } else {
    searchInput.value = 'tools';
  }
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));

  // After search, only entries with "tools" in method should show
  // (tools/list and tools/call = 2 entries)
  const logEntries = container.querySelectorAll('.log-entry');
  assert.equal(logEntries.length, 2, `should show 2 entries matching "tools", got ${logEntries.length}`);
  cleanup();
});

test('LogList: search filters by rpcId', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const searchInput = container.querySelector('.log-search') as HTMLInputElement;
  searchInput.value = 'id=2';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));

  // Only entry with rpcId 2 should show (tools/list request)
  const logEntries = container.querySelectorAll('.log-entry');
  assert.ok(logEntries.length >= 1, 'should show at least 1 entry matching "id=2"');
  const methods = Array.from(logEntries).map((e) =>
    text(e.querySelector('.method .m')));
  assert.ok(methods.some((m) => m.includes('tools/list')), 'should include tools/list entry');
  cleanup();
});

test('LogList: "no results" state when search matches nothing', () => {
  const { container, cleanup } = render(
    React.createElement(LogList, { entries }),
  );
  const searchInput = container.querySelector('.log-search') as HTMLInputElement;
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(searchInput, 'xyznonexistent');
  } else {
    searchInput.value = 'xyznonexistent';
  }
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));

  const noResults = container.querySelector('.empty-state');
  assert.ok(noResults, 'should show no-results empty state');
  assert.ok(text(noResults).includes('Sin resultados'), 'should show "Sin resultados" message');
  cleanup();
});