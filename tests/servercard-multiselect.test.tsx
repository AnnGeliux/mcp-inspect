/**
 * Multi-select tests for ServerCard (Ctrl+Click + checkbox).
 * Run with: node --test --import tsx --import ./tests/dom-setup.ts tests/servercard-multiselect.test.tsx
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from './render.tsx';
import ServerCard from '../src/renderer/components/ServerCard.tsx';
import { SavedServer } from '../src/shared/types.ts';

const server: SavedServer = {
  id: 's-1',
  name: 'My Server',
  config: { command: 'npx', args: ['-y', 'something'] },
};

test('ServerCard multi-select: renders the checkbox when onToggleChecked is provided', () => {
  const r = render(React.createElement(ServerCard, {
    server, selected: false, running: false,
    onSelect: () => {}, onToggleChecked: () => {}, onEdit: () => {}, onDelete: () => {},
  }));
  const cb = r.querySelector('input.card-check');
  assert.ok(cb, 'checkbox should render');
  r.cleanup();
});

test('ServerCard multi-select: no checkbox when onToggleChecked is absent', () => {
  const r = render(React.createElement(ServerCard, {
    server, selected: false, running: false, onSelect: () => {}, onEdit: () => {}, onDelete: () => {},
  }));
  assert.equal(r.querySelector('input.card-check'), null);
  r.cleanup();
});

test('ServerCard multi-select: checkbox reflects the checked prop', () => {
  const r = render(React.createElement(ServerCard, {
    server, selected: false, checked: true, running: false,
    onSelect: () => {}, onToggleChecked: () => {}, onEdit: () => {}, onDelete: () => {},
  }));
  const cb = r.querySelector('input.card-check') as HTMLInputElement;
  assert.ok(cb, 'checkbox should render');
  assert.equal(cb.checked, true);
  const card = r.container.querySelector('.card');
  assert.ok(card?.className.includes('card-checked'), 'card carries card-checked class');
  r.cleanup();
});

test('ServerCard multi-select: checkbox click does not trigger exclusive select', () => {
  let selected = 0;
  let toggled = 0;
  const r = render(React.createElement(ServerCard, {
    server, selected: false, running: false,
    onSelect: () => { selected++; },
    onToggleChecked: () => { toggled++; },
    onEdit: () => {}, onDelete: () => {},
  }));
  const cb = r.querySelector('input.card-check') as HTMLElement;
  cb.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(selected, 0, 'checkbox click must not trigger exclusive select');
  r.cleanup();
});

test('ServerCard multi-select: plain click selects exclusively (no toggle)', () => {
  let selected = 0;
  let toggled = 0;
  const r = render(React.createElement(ServerCard, {
    server, selected: false, running: false,
    onSelect: () => { selected++; },
    onToggleChecked: () => { toggled++; },
    onEdit: () => {}, onDelete: () => {},
  }));
  const card = r.container.querySelector('.card') as HTMLElement;
  card.dispatchEvent(new (window as unknown as { MouseEvent: typeof Event }).MouseEvent('click', { bubbles: true }));
  assert.equal(selected, 1, 'plain click selects');
  assert.equal(toggled, 0, 'plain click does not toggle');
  r.cleanup();
});