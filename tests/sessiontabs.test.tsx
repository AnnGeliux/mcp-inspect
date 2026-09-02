/**
 * SessionTabs UI tests (multi-server M1).
 * Renders the tabs and checks selection / close / status pills.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SessionTabs from '../src/renderer/components/SessionTabs';
import { SessionInfo } from '../src/shared/types';

function render(sessions: SessionInfo[], activeServerId: string | null): string {
  return renderToString(
    createElement(SessionTabs, {
      sessions,
      activeServerId,
      onSelect: () => {},
      onClose: () => {},
    }),
  );
}

function mkSession(over: Partial<SessionInfo>): SessionInfo {
  return {
    serverId: 'srv-1',
    name: 'everything',
    kind: 'stdio',
    running: true,
    paused: false,
    queued: { c2s: 0, s2c: 0 },
    ...over,
  };
}

test('SessionTabs: renders nothing when there are no sessions', () => {
  const html = render([], null);
  assert.equal(html, '');
});

test('SessionTabs: renders one tab per session', () => {
  const html = render(
    [mkSession({ serverId: 'a', name: 'alpha' }), mkSession({ serverId: 'b', name: 'beta' })],
    'a',
  );
  assert.ok(html.includes('alpha'));
  assert.ok(html.includes('beta'));
  assert.equal(html.match(/session-tab\b/g)?.length, 2);
});

test('SessionTabs: the active tab carries the active class, others do not', () => {
  const html = render(
    [mkSession({ serverId: 'a' }), mkSession({ serverId: 'b' })],
    'b',
  );
  const tabs = html.match(/class="session-tab[ "]/g) ?? [];
  assert.equal(tabs.length, 2);
  const active = html.match(/class="session-tab active"/g) ?? [];
  assert.equal(active.length, 1);
});

test('SessionTabs: shows name, kind badge and close button per tab', () => {
  const html = render([mkSession({ name: 'echo', kind: 'stdio' })], 'echo-server');
  assert.ok(html.includes('tab-name'));
  assert.ok(html.includes('tab-kind'));
  assert.ok(html.includes('tab-close'));
  assert.ok(html.includes('echo'));
});

test('SessionTabs: paused session shows the pause marker and queue count', () => {
  const html = render(
    [mkSession({ serverId: 'a', paused: true, queued: { c2s: 2, s2c: 1 } })],
    'a',
  );
  assert.ok(html.includes('⏸'));
  assert.ok(html.includes('tab-queued'));
  assert.ok(html.includes('3'));
});

test('SessionTabs: stopped session shows the stopped dot, live shows live dot', () => {
  const stopped = render([mkSession({ running: false })], 'a');
  const live = render([mkSession({ running: true })], 'a');
  assert.ok(stopped.includes('tab-dot stopped'));
  assert.ok(live.includes('tab-dot live'));
});