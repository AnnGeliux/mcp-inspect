/**
 * Tests for the 2-step Wizard component.
 * Tests step transitions, progress display, and navigation.
 *
 * Run with: node --test --import tsx tests/wizard.test.tsx
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, click, text } from './render.tsx';
import Wizard from '../src/renderer/components/Wizard.tsx';
import { SavedServer, SavedClient } from '../src/shared/types.ts';

// ——— Fixtures ———

const servers: SavedServer[] = [
  { id: 's1', name: 'Server A', config: { command: 'npx', args: ['pkg-a'] } },
  { id: 's2', name: 'Server B', config: { command: 'npx', args: ['pkg-b'] } },
];

const clients: SavedClient[] = [
  { id: 'c1', name: 'Client A', config: { type: 'sdk', name: 'ca', command: 'node', args: [] } },
  { id: 'c2', name: 'Client B', config: { type: 'inspector', name: 'cb', command: 'npx', args: ['x'] } },
];

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    step: 1 as const,
    servers,
    clients,
    selectedServerId: null,
    selectedClientId: null,
    running: false,
    clientConnected: false,
    onSelectServer: () => {},
    onSelectClient: () => {},
    onAddServer: () => {},
    onAddClient: () => {},
    onAdvance: () => {},
    onBack: () => {},
    ...overrides,
  };
}

// ——— Tests ———

test('Wizard: starts on step 1 (server selection)', () => {
  const { container, cleanup } = render(React.createElement(Wizard, makeProps()));
  const stepText = text(container.querySelector('.wizard-progress-text'));
  assert.ok(stepText.includes('Paso 1 de 2'), `should show step 1, got: ${stepText}`);
  assert.ok(stepText.includes('Server'), 'should mention Server selection');
  cleanup();
});

test('Wizard: step 2 shows client selection text', () => {
  const { container, cleanup } = render(
    React.createElement(Wizard, makeProps({ step: 2 })),
  );
  const stepText = text(container.querySelector('.wizard-progress-text'));
  assert.ok(stepText.includes('Paso 2 de 2'), `should show step 2, got: ${stepText}`);
  assert.ok(stepText.includes('Client'), 'should mention Client selection');
  cleanup();
});

test('Wizard: shows progress 1/2 on step 1', () => {
  const { container, cleanup } = render(React.createElement(Wizard, makeProps()));
  const dots = container.querySelectorAll('.wizard-dot');
  assert.equal(dots.length, 2, 'should have 2 dots');
  assert.ok(dots[0]!.classList.contains('active'), 'dot 1 should be active on step 1');
  assert.ok(!dots[1]!.classList.contains('active'), 'dot 2 should NOT be active on step 1');
  cleanup();
});

test('Wizard: shows progress 2/2 on step 2 (both dots active)', () => {
  const { container, cleanup } = render(
    React.createElement(Wizard, makeProps({ step: 2 })),
  );
  const dots = container.querySelectorAll('.wizard-dot');
  assert.ok(dots[0]!.classList.contains('active'), 'dot 1 should be active on step 2');
  assert.ok(dots[1]!.classList.contains('active'), 'dot 2 should be active on step 2');
  cleanup();
});

test('Wizard: clicking Siguiente advances from step 1 to step 2', () => {
  let advanceCalled = false;
  const { container, cleanup } = render(
    React.createElement(
      Wizard,
      makeProps({ step: 1, selectedServerId: 's1', onAdvance: () => { advanceCalled = true; } }),
    ),
  );
  const btn = container.querySelector('.btn.primary') as HTMLElement;
  assert.ok(btn, 'should have a primary button (Siguiente)');
  assert.ok(text(btn).includes('Siguiente'), 'button should say Siguiente');
  click(btn);
  assert.ok(advanceCalled, 'onAdvance should be called');
  cleanup();
});

test('Wizard: Siguiente button only appears when server is selected (step 1)', () => {
  // No server selected → no advance button
  const { container, cleanup } = render(React.createElement(Wizard, makeProps()));
  let btn = container.querySelector('.wizard-nav .btn.primary');
  assert.equal(btn, null, 'should NOT show Siguiente when no server selected');
  cleanup();

  // Server selected → advance button appears
  const r2 = render(
    React.createElement(Wizard, makeProps({ selectedServerId: 's1' })),
  );
  btn = r2.container.querySelector('.wizard-nav .btn.primary');
  assert.ok(btn, 'should show Siguiente when server is selected');
  r2.cleanup();
});

test('Wizard: Atrás button appears on step 2', () => {
  const { container, cleanup } = render(
    React.createElement(Wizard, makeProps({ step: 2 })),
  );
  const backBtn = container.querySelector('.wizard-nav .btn');
  assert.ok(backBtn, 'should have a back button on step 2');
  assert.ok(text(backBtn as HTMLElement).includes('Atrás'), 'button should say Atrás');
  cleanup();
});

test('Wizard: Atrás button does NOT appear on step 1', () => {
  const { container, cleanup } = render(React.createElement(Wizard, makeProps()));
  const backBtn = container.querySelector('.wizard-nav .btn:not(.primary)');
  assert.equal(backBtn, null, 'should NOT have a back button on step 1');
  cleanup();
});

test('Wizard: clicking Atrás calls onBack', () => {
  let backCalled = false;
  const { container, cleanup } = render(
    React.createElement(
      Wizard,
      makeProps({ step: 2, onBack: () => { backCalled = true; } }),
    ),
  );
  const backBtn = container.querySelector('.wizard-nav .btn') as HTMLElement;
  click(backBtn);
  assert.ok(backCalled, 'onBack should be called');
  cleanup();
});

test('Wizard: step 1 renders server cards', () => {
  const { container, cleanup } = render(React.createElement(Wizard, makeProps()));
  const cards = container.querySelectorAll('.card');
  // 2 servers + 1 "add custom" button = 3
  assert.ok(cards.length >= 3, `should render at least 3 cards (2 servers + add), got ${cards.length}`);
  cleanup();
});

test('Wizard: step 2 renders client cards', () => {
  const { container, cleanup } = render(
    React.createElement(Wizard, makeProps({ step: 2 })),
  );
  const cards = container.querySelectorAll('.card');
  assert.ok(cards.length >= 3, `should render at least 3 cards (2 clients + add), got ${cards.length}`);
  cleanup();
});

test('Wizard: step 2 with selected client shows ¡Listo! button', () => {
  const { container, cleanup } = render(
    React.createElement(Wizard, makeProps({ step: 2, selectedClientId: 'c1' })),
  );
  const btn = container.querySelector('.wizard-nav .btn.primary') as HTMLElement;
  assert.ok(btn, 'should have a primary button');
  assert.ok(text(btn).includes('Listo'), 'should say ¡Listo! when client is selected');
  cleanup();
});