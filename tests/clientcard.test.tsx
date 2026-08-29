/**
 * Tests for the ClientCard component.
 * Tests rendering, badges, click handlers, preset behavior, and icons.
 *
 * Run with: node --test --import tsx tests/clientcard.test.tsx
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, click, text } from './render.tsx';
import ClientCard from '../src/renderer/components/ClientCard.tsx';
import { SavedClient } from '../src/shared/types.ts';

// ——— Fixtures ———

const customClient: SavedClient = {
  id: 'c-custom',
  name: 'My Custom Client',
  config: { type: 'sdk', name: 'custom-client', command: 'node', args: [] },
};

const presetClient: SavedClient = {
  id: 'preset-sdk',
  name: 'SDK Client (@modelcontextprotocol/sdk)',
  preset: true,
  config: { type: 'sdk', name: 'mcp-inspector-client', command: 'node', args: [] },
};

const inspectorClient: SavedClient = {
  id: 'c-inspector',
  name: 'Inspector oficial',
  config: { type: 'inspector', name: 'inspector', command: 'npx', args: ['@modelcontextprotocol/inspector'] },
};

// ——— Tests ———

test('ClientCard: renders name correctly', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const nameEl = container.querySelector('.card-name');
  assert.ok(nameEl, 'should have a card-name element');
  assert.equal(text(nameEl), 'My Custom Client');
  cleanup();
});

test('ClientCard: renders description derived from type and command', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const descEl = container.querySelector('.card-desc');
  assert.ok(descEl, 'should have a card-desc element');
  const desc = text(descEl);
  assert.ok(desc.includes('sdk'), 'description should contain client type');
  assert.ok(desc.includes('node'), 'description should contain command');
  cleanup();
});

test('ClientCard: shows "preset" badge for presets', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: presetClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const badge = container.querySelector('.card-badge');
  assert.ok(badge, 'should have a badge');
  assert.equal(text(badge), 'preset');
  assert.ok(badge!.classList.contains('badge-preset'), 'should have badge-preset class');
  cleanup();
});

test('ClientCard: shows "idle" badge for non-preset, non-connected clients', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const badge = container.querySelector('.card-badge');
  assert.ok(badge, 'should have a badge');
  assert.equal(text(badge), 'idle');
  assert.ok(badge!.classList.contains('badge-idle'), 'should have badge-idle class');
  cleanup();
});

test('ClientCard: shows "connected" badge for connected clients', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: true, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const badge = container.querySelector('.card-badge');
  assert.ok(badge, 'should have a badge');
  assert.equal(text(badge), 'connected');
  assert.ok(badge!.classList.contains('badge-running'), 'connected should use badge-running class');
  cleanup();
});

test('ClientCard: does NOT show delete button for presets', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: presetClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const deleteBtn = container.querySelector('.card-action-btn.danger');
  assert.equal(deleteBtn, null, 'presets should NOT have a delete button');
  cleanup();
});

test('ClientCard: shows delete button for non-presets', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const deleteBtn = container.querySelector('.card-action-btn.danger');
  assert.ok(deleteBtn, 'non-presets should have a delete button');
  cleanup();
});

test('ClientCard: clicking the card calls onSelect', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, onSelect: () => { called = true; }, onEdit: () => {}, onDelete: () => {} }),
  );
  const card = container.querySelector('.card') as HTMLElement;
  click(card);
  assert.ok(called, 'onSelect should be called when card is clicked');
  cleanup();
});

test('ClientCard: clicking edit button calls onEdit', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => { called = true; }, onDelete: () => {} }),
  );
  const editBtn = container.querySelector('.card-action-btn[title="Editar"]') as HTMLElement;
  assert.ok(editBtn, 'should have an edit button');
  click(editBtn);
  assert.ok(called, 'onEdit should be called when edit button is clicked');
  cleanup();
});

test('ClientCard: clicking delete button calls onDelete (non-preset only)', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => { called = true; } }),
  );
  const deleteBtn = container.querySelector('.card-action-btn.danger') as HTMLElement;
  assert.ok(deleteBtn, 'should have a delete button');
  click(deleteBtn);
  assert.ok(called, 'onDelete should be called when delete button is clicked');
  cleanup();
});

test('ClientCard: selected card gets card-selected class', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: true, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const card = container.querySelector('.card');
  assert.ok(card!.classList.contains('card-selected'), 'selected card should have card-selected class');
  cleanup();
});

test('ClientCard: disabled card does not call onSelect on click', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: customClient, selected: false, connected: false, disabled: true, onSelect: () => { called = true; }, onEdit: () => {}, onDelete: () => {} }),
  );
  const card = container.querySelector('.card') as HTMLElement;
  assert.ok(card.classList.contains('card-disabled'), 'should have card-disabled class');
  click(card);
  assert.ok(!called, 'onSelect should NOT be called when card is disabled');
  cleanup();
});

// ——— Icon tests ———

test('ClientCard: SDK client shows 📦 icon', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: presetClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const icon = container.querySelector('.card-icon');
  assert.ok(icon, 'should have a card-icon');
  assert.equal(text(icon), '📦', 'SDK client should show 📦 icon');
  cleanup();
});

test('ClientCard: Inspector client shows 🔍 icon', () => {
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: inspectorClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const icon = container.querySelector('.card-icon');
  assert.ok(icon, 'should have a card-icon');
  assert.equal(text(icon), '🔍', 'Inspector client should show 🔍 icon');
  cleanup();
});

test('ClientCard: generic client shows default 🧑‍💻 icon', () => {
  const genericClient: SavedClient = {
    id: 'c-gen',
    name: 'Unknown Client',
    config: { type: 'sdk', name: 'unknown', command: 'node', args: [] },
  };
  const { container, cleanup } = render(
    React.createElement(ClientCard, { client: genericClient, selected: false, connected: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const icon = container.querySelector('.card-icon');
  assert.ok(icon, 'should have a card-icon');
  assert.equal(text(icon), '🧑‍💻', 'generic client should show 🧑‍💻 icon');
  cleanup();
});