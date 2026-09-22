// src/test/jsdom-setup.mjs — installs a jsdom global environment for
// `node --test` files that need a real, live DOM (focus, keyboard events,
// element measurement) rather than the static-markup rendering
// payer-item-row.security.test.mjs already established (renderToStaticMarkup
// has no document, no focus, no event dispatch — it cannot verify the new
// Radix accordion keyboard behaviour or the new real focus-stealing this
// pass adds, which is why this file exists at all).
//
// Import this file FIRST, before importing React, react-dom/client, or
// @testing-library/react — those libraries read `globalThis.document` at
// import/module-init time, not lazily.
//
// jsdom is a devDependency only (package.json), never part of `vite
// build`'s output — no browser ever runs this file.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true, // gives us requestAnimationFrame, needed by React 19's scheduler
});

const { window } = dom;

const keys = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'CustomEvent',
  'DocumentFragment',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];

for (const key of keys) {
  if (window[key] === undefined) continue;
  if (key === 'navigator') {
    // Node 21+ defines a read-only global `navigator` getter of its own —
    // redefine the property descriptor instead of assigning to it.
    Object.defineProperty(globalThis, 'navigator', {
      value: window.navigator,
      configurable: true,
      writable: true,
    });
    continue;
  }
  globalThis[key] = window[key];
}

// React DOM's test-utils / scheduler check this to decide whether it is
// running in a browser-like environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export { dom, window };
