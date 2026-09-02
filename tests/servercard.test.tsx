/**
 * Tests for the ServerCard component.
 * Tests rendering, badges, click handlers, and preset behavior.
 *
 * Run with: node --test --import tsx tests/servercard.test.tsx
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, click, text } from './render.tsx';
import ServerCard from '../src/renderer/components/ServerCard.tsx';
import { SavedServer } from '../src/shared/types.ts';

// ——— Fixtures ———

const customServer: SavedServer = {
  id: 's-custom',
  name: 'My Custom Server',
  config: { command: 'npx', args: ['-y', '@modelcontextprotocol/everything-server'] },
};

const presetServer: SavedServer = {
  id: 'preset-everything',
  name: 'everything-server (MCP real)',
  preset: true,
  config: { command: 'node', args: ['server.js'] },
};

const longCommandServer: SavedServer = {
  id: 's-long',
  name: 'Long Server',
  config: {
    command: 'npx',
    args: ['-y', '@some/very-long-package-name-that-exceeds-fifty-characters-limit-yes'],
  },
};

// ——— Tests ———

test('ServerCard: renders name correctly', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const nameEl = container.querySelector('.card-name');
  assert.ok(nameEl, 'should have a card-name element');
  assert.equal(text(nameEl), 'My Custom Server');
  cleanup();
});

test('ServerCard: renders description derived from command', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const descEl = container.querySelector('.card-desc');
  assert.ok(descEl, 'should have a card-desc element');
  const desc = text(descEl);
  assert.ok(desc.includes('npx'), 'description should contain command');
  assert.ok(desc.includes('everything-server'), 'description should contain args');
  cleanup();
});

test('ServerCard: truncates long command descriptions', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: longCommandServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const descEl = container.querySelector('.card-desc');
  assert.ok(descEl, 'should have a card-desc element');
  const desc = text(descEl);
  assert.ok(desc.includes('…') || desc.includes('...'), 'long description should contain ellipsis');
  assert.ok(desc.length < 60, 'truncated description should be shorter than 60 chars');
  cleanup();
});

test('ServerCard: shows "preset" badge for presets', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: presetServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const badge = container.querySelector('.card-badge');
  assert.ok(badge, 'should have a badge');
  assert.equal(text(badge), 'preset');
  assert.ok(badge!.classList.contains('badge-preset'), 'should have badge-preset class');
  cleanup();
});

test('ServerCard: shows "idle" badge for non-preset, non-running servers', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const badge = container.querySelector('.card-badge');
  assert.ok(badge, 'should have a badge');
  assert.equal(text(badge), 'idle');
  assert.ok(badge!.classList.contains('badge-idle'), 'should have badge-idle class');
  cleanup();
});

test('ServerCard: shows "running" badge for running servers', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: true, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const badge = container.querySelector('.card-badge');
  assert.ok(badge, 'should have a badge');
  assert.equal(text(badge), 'running');
  assert.ok(badge!.classList.contains('badge-running'), 'should have badge-running class');
  cleanup();
});

test('ServerCard: does NOT show delete button for presets', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: presetServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const deleteBtn = container.querySelector('.card-action-btn.danger');
  assert.equal(deleteBtn, null, 'presets should NOT have a delete button');
  cleanup();
});

test('ServerCard: shows delete button for non-presets', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const deleteBtn = container.querySelector('.card-action-btn.danger');
  assert.ok(deleteBtn, 'non-presets should have a delete button');
  cleanup();
});

test('ServerCard: clicking the card calls onSelect', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => { called = true; }, onEdit: () => {}, onDelete: () => {} }),
  );
  const card = container.querySelector('.card') as HTMLElement;
  click(card);
  assert.ok(called, 'onSelect should be called when card is clicked');
  cleanup();
});

test('ServerCard: clicking edit button calls onEdit', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => {}, onEdit: () => { called = true; }, onDelete: () => {} }),
  );
  const editBtn = container.querySelector('.card-action-btn[title="Edit"]') as HTMLElement;
  assert.ok(editBtn, 'should have an edit button');
  click(editBtn);
  assert.ok(called, 'onEdit should be called when edit button is clicked');
  cleanup();
});

test('ServerCard: clicking delete button calls onDelete (non-preset only)', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => { called = true; } }),
  );
  const deleteBtn = container.querySelector('.card-action-btn.danger') as HTMLElement;
  assert.ok(deleteBtn, 'should have a delete button');
  click(deleteBtn);
  // confirm() is mocked to return true in setup.ts
  assert.ok(called, 'onDelete should be called when delete button is clicked');
  cleanup();
});

test('ServerCard: shows edit button for presets too', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: presetServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const editBtn = container.querySelector('.card-action-btn[title="Edit"]') as HTMLElement;
  assert.ok(editBtn, 'presets should still have an edit button');
  cleanup();
});

test('ServerCard: uses description field when available', () => {
  const descServer: SavedServer = {
    id: 's-desc',
    name: 'My Server',
    description: 'A custom description',
    config: { command: 'npx', args: ['some-pkg'] },
  };
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: descServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const descEl = container.querySelector('.card-desc');
  assert.ok(descEl, 'should have a card-desc element');
  assert.equal(text(descEl), 'A custom description');
  cleanup();
});

test('ServerCard: shows type badge', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const typeBadge = container.querySelector('.card-type-badge');
  assert.ok(typeBadge, 'should have a card-type-badge element');
  assert.equal(text(typeBadge), 'stdio');
  cleanup();
});

test('ServerCard: selected card gets card-selected class', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: true, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const card = container.querySelector('.card');
  assert.ok(card!.classList.contains('card-selected'), 'selected card should have card-selected class');
  cleanup();
});

test('ServerCard: disabled card does not call onSelect on click', () => {
  let called = false;
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, disabled: true, onSelect: () => { called = true; }, onEdit: () => {}, onDelete: () => {} }),
  );
  const card = container.querySelector('.card') as HTMLElement;
  assert.ok(card.classList.contains('card-disabled'), 'should have card-disabled class');
  click(card);
  assert.ok(!called, 'onSelect should NOT be called when card is disabled');
  cleanup();
});

test('ServerCard: disabled card does not show action buttons', () => {
  const { container, cleanup } = render(
    React.createElement(ServerCard, { server: customServer, selected: false, running: false, disabled: true, onSelect: () => {}, onEdit: () => {}, onDelete: () => {} }),
  );
  const actions = container.querySelector('.card-actions');
  assert.equal(actions, null, 'disabled card should NOT have action buttons');
  cleanup();
});