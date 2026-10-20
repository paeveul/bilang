//
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, cleanup } from '@testing-library/react';
import ParsingScreen from './ParsingScreen.jsx';
import { BillProvider } from '../state/BillContext.jsx';

test.afterEach(() => {
  cleanup();
});

test('no progress/percentage semantics anywhere in the rendered markup', () => {
  const { container } = render(
    <BillProvider>
      <ParsingScreen />
    </BillProvider>
  );
  assert.equal(container.querySelector('[role="progressbar"]'), null);
  assert.equal(container.querySelector('[aria-valuenow]'), null);
  assert.equal(container.querySelector('[aria-valuemax]'), null);
  assert.doesNotMatch(container.textContent, /%|percent/i);
});

test('the wait state is still communicated accessibly — role="status" with a label', () => {
  const { container } = render(
    <BillProvider>
      <ParsingScreen />
    </BillProvider>
  );
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
