/**
 * Global test setup for component tests.
 * Provides a minimal DOM environment (happy-dom) for React component testing.
 * This file is loaded via --import so it runs before any test file.
 */

import { Window } from 'happy-dom';

// Create a happy-dom window and attach it to globalThis
const win = new Window();
const { document, HTMLElement, Event, Node, CustomEvent } = win as unknown as {
  document: Document;
  HTMLElement: typeof HTMLElement;
  Event: typeof Event;
  Node: typeof Node;
  CustomEvent: typeof CustomEvent;
};

// Attach DOM globals needed by React
(globalThis as Record<string, unknown>).window = win;
(globalThis as Record<string, unknown>).document = win.document;
(globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;
(globalThis as Record<string, unknown>).Event = win.Event;
(globalThis as Record<string, unknown>).Node = win.Node;
(globalThis as Record<string, unknown>).CustomEvent = win.CustomEvent;
(globalThis as Record<string, unknown>).navigator = win.navigator;
(globalThis as Record<string, unknown>).MutationObserver = win.MutationObserver;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0);
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) =>
  clearTimeout(id);

// Mock window.confirm (used by ServerCard/ClientCard delete buttons)
(globalThis as Record<string, unknown>).confirm = () => true;

// Mock window.scrollTo
(globalThis as Record<string, unknown>).scrollTo = () => {};