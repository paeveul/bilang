// src/screens/ParsingScreen.motion.test.jsx — Item 22 Step 9: the "Scan wait"
// motion.dev placement (§22.3 of bilang-mvp1-implementation-plans.md).
//
// §22.3's constraint: "Must loop indefinitely with no implied percentage of
// completion — the app cannot know how long Claude will take, and a
// determinate progress bar would be a lie." What's verified here is the
// STRUCTURAL contract that constraint implies, which is what's reliably
// observable in jsdom without real requestAnimationFrame-driven timing:
//   1. No progress/percentage semantics exist anywhere in the markup — no
//      `role="progressbar"`, no `aria-valuenow`/`aria-valuemax`, no numeric
//      percentage text. A determinate progress UI would show one of these;
//      this screen must show none.
//   2. The wait state IS communicated (role="status" + an accessible label),
//      just not as a percentage.
//   3. ParsingScreen.jsx's own animate/transition props are `{ rotate: 360 }`
//      with `{ repeat: Infinity, ease: 'linear' }` — read directly from
//      source below as a second, source-level confirmation alongside the
//      DOM-level checks above (real elapsed-time animation smoothness is a
//      visual concern verified manually in Step 11's Vercel-preview smoke
//      test, not here).
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, cleanup } from '@testing-library/react';
import ParsingScreen from './ParsingScreen.jsx';

test.afterEach(() => {
  cleanup();
});

test('no progress/percentage semantics anywhere in the rendered markup', () => {
  const { container } = render(<ParsingScreen />);
  assert.equal(container.querySelector('[role="progressbar"]'), null);
  assert.equal(container.querySelector('[aria-valuenow]'), null);
  assert.equal(container.querySelector('[aria-valuemax]'), null);
  assert.doesNotMatch(container.textContent, /%|percent/i);
});

test('the wait state is still communicated accessibly — role="status" with a label', () => {
  const { container } = render(<ParsingScreen />);
  const status = container.querySelector('[role="status"]');
  assert.ok(status, 'a role="status" element must exist');
  assert.equal(status.getAttribute('aria-label'), 'Reading your receipt');
});

test('source-level: the loop is indefinite (repeat: Infinity) and linear, not eased toward a finish line', () => {
  const source = readFileSync(fileURLToPath(new URL('./ParsingScreen.jsx', import.meta.url)), 'utf8');
  assert.match(source, /animate=\{\{\s*rotate:\s*360\s*\}\}/, 'must be a continuous rotation, not a fill/width animation');
  assert.match(source, /repeat:\s*Infinity/, 'must loop indefinitely — no completion state to reach');
  assert.match(source, /ease:\s*'linear'/, 'must be constant-speed — an eased ease-in/out reads as approaching a finish line');
});
