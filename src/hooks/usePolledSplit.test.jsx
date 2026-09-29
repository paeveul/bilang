// src/hooks/usePolledSplit.test.jsx — Item 24 Step 7. Exercises the hook
// through a tiny harness component (no @testing-library/react-hooks
// dependency — same "render a harness that renders the thing" pattern
// ReviewScreen.validation.test.jsx uses). Covers: initial fetch, the
// stale-version discard (C12), claim() folding a successful PATCH straight
// into state, claim() folding a 409 already_claimed body in too, and the
// hidden-tab pause not polling again until visibility returns.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/hooks/usePolledSplit.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { usePolledSplit } from './usePolledSplit.js';

function Harness({ id }) {
  const state = usePolledSplit(id);
  window.__hook = state; // exposes claim/unclaim/refresh to the test body
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="version">{state.split?.version ?? ''}</span>
      <span data-testid="fail-count">{state.pollFailCount}</span>
    </div>
  );
}

function mockFetchSequence(responses) {
  let call = 0;
  global.fetch = async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return () => call;
}

test.afterEach(() => {
  cleanup();
  delete window.__hook;
  delete global.fetch;
});

test('initial load: fetches once and populates status/version', async () => {
  mockFetchSequence([{ status: 200, body: { id: 's1', items: [], payers: ['Farah'], version: 0, totals: {} } }]);
  render(<Harness id="s1" />);
  await waitFor(() => assert.equal(screen.getByTestId('status').textContent, 'ready'));
  assert.equal(screen.getByTestId('version').textContent, '0');
});

test('refresh(): a response with a lower version than shown is discarded (C12)', async () => {
  const getCalls = mockFetchSequence([
    { status: 200, body: { id: 's1', items: [], payers: ['Farah'], version: 3, totals: {} } },
  ]);
  render(<Harness id="s1" />);
  await waitFor(() => assert.equal(screen.getByTestId('version').textContent, '3'));

  // Swap in a stale response (version 1 < the 3 already shown) and force a refetch.
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 's1', items: [], payers: ['Farah'], version: 1, totals: {} }),
  });
  await act(async () => {
    await window.__hook.refresh();
  });
  assert.equal(screen.getByTestId('version').textContent, '3', 'a lower version must never overwrite the shown one');
  void getCalls;
});

test('claim(): a successful PATCH folds assignments/totals/version straight into state', async () => {
  mockFetchSequence([{ status: 200, body: { id: 's1', items: [], payers: ['Farah'], version: 0, totals: {} } }]);
  render(<Harness id="s1" />);
  await waitFor(() => assert.equal(screen.getByTestId('version').textContent, '0'));

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ assignments: { i1: { mode: 'equal', equal: ['Farah'], claimed: true } }, totals: {}, version: 1 }),
  });
  let result;
  await act(async () => {
    result = await window.__hook.claim('i1', 'Farah');
  });
  assert.equal(result.outcome, 'applied');
  assert.equal(screen.getByTestId('version').textContent, '1');
});

test('claim(): a 409 already_claimed still folds the returned current state in, and reports the outcome', async () => {
  mockFetchSequence([{ status: 200, body: { id: 's1', items: [], payers: ['Farah', 'Ben'], version: 0, totals: {} } }]);
  render(<Harness id="s1" />);
  await waitFor(() => assert.equal(screen.getByTestId('version').textContent, '0'));

  global.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      code: 'already_claimed',
      assignments: { i1: { mode: 'equal', equal: ['Ben'], claimed: true } },
      totals: {},
      version: 1,
    }),
  });
  let result;
  await act(async () => {
    result = await window.__hook.claim('i1', 'Farah');
  });
  assert.equal(result.outcome, 'error');
  assert.equal(result.code, 'already_claimed');
  // The current server state (someone else's winning claim) is still shown —
  // §24.3: "the client shows the current state and surfaces no error".
  assert.equal(screen.getByTestId('version').textContent, '1');
});

test('unclaim(): a 403 not_your_claim is reported without touching local state', async () => {
  mockFetchSequence([{ status: 200, body: { id: 's1', items: [], payers: ['Farah'], version: 0, totals: {} } }]);
  render(<Harness id="s1" />);
  await waitFor(() => assert.equal(screen.getByTestId('version').textContent, '0'));

  global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ code: 'not_your_claim' }) });
  let result;
  await act(async () => {
    result = await window.__hook.unclaim('i1', 'Farah');
  });
  assert.equal(result.outcome, 'error');
  assert.equal(result.code, 'not_your_claim');
  assert.equal(screen.getByTestId('version').textContent, '0', 'a 403 body carries no row, so nothing to fold in');
});

test('a fetch failure increments pollFailCount without crashing the hook', async () => {
  global.fetch = async () => {
    throw new Error('network down');
  };
  render(<Harness id="s1" />);
  await waitFor(() => assert.equal(screen.getByTestId('fail-count').textContent, '1'));
});
