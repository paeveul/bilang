// src/App.reduced-motion-no-preference.test.jsx — Item 22 Step 9: verifies
// `<MotionConfig reducedMotion="user">` (App.jsx) actually wires up to the
// OS-level `prefers-reduced-motion` signal — the "then set the operating
// system to reduce motion and confirm all six respect it" verify line in
// §22.4's Step 9 (bilang-mvp1-implementation-plans.md).
//
// HOW THIS TEST STANDS IN FOR A PHYSICAL OS TOGGLE, HONESTLY STATED: an
// automated agent has no OS settings panel to click. What it can do — and
// what this test does — is drive the exact browser API surface a real OS
// toggle produces: `window.matchMedia('(prefers-reduced-motion)')`
// resolving `.matches`. This is the same mechanism Chrome DevTools' own
// "Emulate CSS media feature prefers-reduced-motion" control uses, and it
// is the only signal `MotionConfig reducedMotion="user"` actually reads —
// confirmed by reading node_modules/motion-dom/dist/cjs/index.js's
// `initPrefersReducedMotion` before writing this test; it listens on
// exactly this media query and nothing else. Proving the wiring responds
// correctly to that signal is what's automatable and repeatable from here;
// a literal physical-device confirmation still belongs in Step 11's manual
// smoke-test pass, and is flagged there rather than silently presented as
// covered by this unit test.
//
// This is the "no preference" half of the pair — App.reduced-motion-reduce
// .test.jsx is the "reduce" half. See that file's header comment for why
// they're two separate files rather than two `test()` blocks in one (the
// short version: motion-dom's reduced-motion state is a module-level
// singleton, and Node's test runner only gives fresh module state per
// *file*, not per `test()` block), and for why every import of
// @testing-library/react / motion/react below is a dynamic `import()`
// placed AFTER the jsdom/matchMedia setup rather than a static top-level
// `import` — that file's comment records the direct experiment that showed
// a static import here produces the wrong (stale) answer.
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

window.matchMedia = (query) => ({
  matches: false,
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

test('MotionConfig reducedMotion="user" does NOT report reduced motion when the OS has no preference set', () => {
  const { container } = render(
    <MotionConfig reducedMotion="user">
      <Probe />
    </MotionConfig>
  );
  assert.equal(container.textContent, 'full-motion');
});
