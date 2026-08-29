/**
 * Test helper: render a React component into the DOM and return container + queries.
 * Works with happy-dom (no jsdom required).
 * React 19 createRoot is async — we use flushSync for synchronous rendering in tests.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

export function render(component: React.ReactElement): {
  container: HTMLElement;
  querySelector: (sel: string) => HTMLElement | null;
  querySelectorAll: (sel: string) => HTMLElement[];
  findByText: (text: string) => HTMLElement | null;
  findByTitle: (title: string) => HTMLElement | null;
  cleanup: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  // Use flushSync to force synchronous rendering in tests
  flushSync(() => {
    root.render(component);
  });

  const querySelector = (sel: string) => container.querySelector(sel) as HTMLElement | null;
  const querySelectorAll = (sel: string) =>
    Array.from(container.querySelectorAll(sel)) as HTMLElement[];
  const findByText = (text: string) => {
    const all = container.querySelectorAll('*');
    for (const el of all) {
      if (el.textContent === text) return el as HTMLElement;
    }
    return null;
  };
  const findByTitle = (title: string) => {
    const all = container.querySelectorAll('[title]');
    for (const el of all) {
      if (el.getAttribute('title') === title) return el as HTMLElement;
    }
    return null;
  };

  const cleanup = () => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  };

  return { container, querySelector, querySelectorAll, findByText, findByTitle, cleanup };
}

/** Click an element (dispatch click event). */
export function click(el: HTMLElement): void {
  el.click();
}

/** Get text content of an element, trimmed. */
export function text(el: HTMLElement | null): string {
  return el?.textContent?.trim() ?? '';
}

/** Re-render with new props (forces a synchronous flush). */
export function rerender(root: ReturnType<typeof createRoot>, component: React.ReactElement): void {
  flushSync(() => {
    root.render(component);
  });
}