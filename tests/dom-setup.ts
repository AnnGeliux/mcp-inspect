/**
 * Loader that sets up happy-dom before test files run.
 * Used via --import: node --test --import tsx --import ./tests/dom-setup.ts
 */

import { Window } from 'happy-dom';

const win = new Window();

// Attach DOM globals needed by React 19
const g = globalThis as Record<string, unknown>;
g.window = win;
g.document = win.document;
g.HTMLElement = win.HTMLElement;
g.Event = win.Event;
g.Node = win.Node;
g.CustomEvent = win.CustomEvent;
try { g.navigator = win.navigator; } catch { /* navigator is read-only in Node 24 */ }
g.MutationObserver = win.MutationObserver;
g.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.confirm = () => true;
g.scrollTo = () => {};