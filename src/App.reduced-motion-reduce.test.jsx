// src/App.reduced-motion-reduce.test.jsx — Item 22 Step 9: OS-level
// `prefers-reduced-motion: reduce` case. See
// App.reduced-motion-no-preference.test.jsx (its sibling, the opposite
// case) for the full explanation of what this pair of tests verifies and
// how it honestly stands in for a physical OS toggle.
//
// Deliberately a SEPARATE FILE from the no-preference case, not two `test()`
// blocks in one file: motion-dom's reduced-motion detection
// (`prefersReducedMotion` in node_modules/motion-dom/dist/cjs/index.js) is a
// module-level singleton, initialised once on first use and never reset.
// Node's built-in test runner gives each *file* passed to `--test` its own
// worker/module registry, so two files each get a fresh singleton; two
// `test()` blocks in one file would not.
//
// Deliberately using dynamic `import()` for @testing-library/react and
// motion/react, AFTER the jsdom globals + `window.matchMedia` mock are
// installed below — not static top-level `import` statements. ES module
// `import` declarations are hoisted and evaluated before any other
// top-level code in the file runs, regardless of where they're textually
// written; a static import of motion/react would therefore execute (and,
// transitively, any module-init-time code in its dependency graph would
// run) before this file's jsdom/matchMedia setup exists, which is the
// opposite of what this test needs. Confirmed by direct experiment while
// writing this test: the static-import version of this exact test reported
// 'full-motion' even with `matches: true` wired up, and switching to a
// dynamic `import()` after setup fixed it — this comment records why, so
// nobody "cleans up" this file back to a static import later.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
]) {
  if (window[key] === undefined) continue;
  if (key === 'navigator') {
    Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
    continue;
  }
  globalThis[key] = window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The exact browser API surface a real "OS set to reduce motion" toggle
// produces — this is the only signal motion-dom's initPrefersReducedMotion
// reads (`window.matchMedia("(prefers-reduced-motion)")`, confirmed by
// reading that source file directly before writing this test).
window.matchMedia = (query) => ({
  matches: true,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
});
globalThis.matchMedia = window.matchMedia;

const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { render, cleanup } = await import('@testing-library/react');
const { MotionConfig, motion, useReducedMotionConfig } = await import('motion/react');

function Probe() {
  const reduced = useReducedMotionConfig();
  return <motion.span data-testid="probe">{reduced ? 'reduced' : 'full-motion'}</motion.span>;
}

test.afterEach(() => {
  cleanup();
});

test('MotionConfig reducedMotion="user" reports reduced motion when the OS prefers-reduced-motion query matches', () => {
  const { container } = render(
    <MotionConfig reducedMotion="user">
      <Probe />
    </MotionConfig>
  );
  assert.equal(container.textContent, 'reduced');
});
