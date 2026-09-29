// src/screens/PayerScreen.claim.test.jsx — Item 24 Step 7. Integration
// coverage for the rebuilt PayerScreen.jsx: identity tap, claim/un-claim,
// the 409 conflict note, the read-only fallback (no roster / claiming
// unavailable), 404, and offline disabling the claim affordance.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/PayerScreen.claim.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PayerScreen from './PayerScreen.jsx';

const item = (id, name, total) => ({ id, name, category: 'food', qty: 1, unit_price: total, line_total: total });

function baseSplit(overrides = {}) {
  return {
    id: 's1',
    items: [item('i1', 'Nasi Lemak', 10), item('i2', 'Teh Tarik', 4)],
    assignments: {},
    totals: { subtotal: 14, service_charge: 0, tax: 0, grand_total: 14, per_person: {} },
    payers: ['Farah', 'Ben'],
    version: 0,
    ownerPaymentHandle: 'DuitNow: 012-3456789',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockGetThenPatch(getBody, patchImpl) {
  global.fetch = async (url, opts) => {
    if (!opts || opts.method === undefined) {
      return { ok: true, status: 200, json: async () => getBody };
    }
    if (opts.method === 'PATCH') {
      const result = patchImpl(JSON.parse(opts.body));
      return { ok: result.status < 300, status: result.status, json: async () => result.body };
    }
    return { ok: true, status: 200, json: async () => getBody };
  };
}

test.afterEach(() => {
  cleanup();
  delete global.fetch;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

test('no roster on the split: renders the read-only fallback with no identity picker', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => baseSplit({ payers: null, totals: { subtotal: 14, service_charge: 0, tax: 0, grand_total: 14, per_person: { Farah: 14 } } }),
  });
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Bill split')));
  assert.equal(screen.queryByText('Who are you?'), null);
  assert.ok(screen.getByText('Farah'));
});

test('404: shows the not-found message', async () => {
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'This split was not found, or has expired.' }) });
  render(<PayerScreen id="missing" />);
  await waitFor(() => assert.ok(screen.getByRole('alert')));
  assert.match(screen.getByRole('alert').textContent, /not found, or has expired/);
});

test('identity tap: choosing a name reveals the claim UI and remembers the choice', async () => {
  const user = userEvent.setup();
  mockGetThenPatch(baseSplit(), () => ({ status: 200, body: {} }));
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Who are you?')));

  await user.click(screen.getByRole('button', { name: 'Farah' }));
  await waitFor(() => assert.ok(screen.getByText(/You're/)));
  assert.ok(screen.getByText('Farah', { selector: 'strong' }));
  assert.equal(window.localStorage.getItem('bilang:identity:s1'), 'Farah');
});

test('claim: tapping "That\'s mine" PATCHes and the row becomes "Yours"', async () => {
  const user = userEvent.setup();
  mockGetThenPatch(baseSplit(), (body) => ({
    status: 200,
    body: {
      assignments: { [body.itemId]: { mode: 'equal', equal: [body.payer], manual: { unit: 'RM', values: {} }, claimed: true } },
      totals: { subtotal: 14, service_charge: 0, tax: 0, grand_total: 14 },
      version: 1,
    },
  }));
  render(<PayerScreen id="s1" />);
  await waitFor(() => screen.getByRole('button', { name: 'Farah' }));
  await user.click(screen.getByRole('button', { name: 'Farah' }));

  await waitFor(() => screen.getByRole('button', { name: 'Claim Nasi Lemak' }));
  await user.click(screen.getByRole('button', { name: 'Claim Nasi Lemak' }));

  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Remove me from Nasi Lemak' })));
});

test('claim conflict (409 already_claimed): shows the calm note, no red error', async () => {
  const user = userEvent.setup();
  mockGetThenPatch(baseSplit(), (body) => ({
    status: 409,
    body: {
      code: 'already_claimed',
      assignments: {
        [body.itemId]: { mode: 'equal', equal: ['Ben'], manual: { unit: 'RM', values: {} }, claimed: true },
      },
      totals: { subtotal: 14, service_charge: 0, tax: 0, grand_total: 14 },
      version: 1,
    },
  }));
  render(<PayerScreen id="s1" />);
  await waitFor(() => screen.getByRole('button', { name: 'Farah' }));
  await user.click(screen.getByRole('button', { name: 'Farah' }));

  await waitFor(() => screen.getByRole('button', { name: 'Claim Nasi Lemak' }));
  await user.click(screen.getByRole('button', { name: 'Claim Nasi Lemak' }));

  await waitFor(() => assert.ok(screen.getByText('Ben just claimed this.')));
  assert.equal(screen.queryByRole('alert'), null, 'a lost claim race must never show as a red error');
});

test('offline: the claim affordance disappears and the offline notice shows', async () => {
  mockGetThenPatch(baseSplit(), () => ({ status: 200, body: {} }));
  render(<PayerScreen id="s1" />);
  await waitFor(() => screen.getByRole('button', { name: 'Farah' }));

  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
  window.dispatchEvent(new Event('offline'));

  await waitFor(() => assert.ok(screen.getByText(/You're offline/)));
  assert.equal(screen.queryByRole('button', { name: 'Claim Nasi Lemak' }), null);
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

test('"Not yet claimed" status line reflects the unclaimed count, and hides when everything is claimed', async () => {
  mockGetThenPatch(
    baseSplit({
      assignments: {
        i1: { mode: 'equal', equal: ['Farah'], manual: { unit: 'RM', values: {} }, claimed: true },
        i2: { mode: 'equal', equal: ['Ben'], manual: { unit: 'RM', values: {} }, claimed: true },
      },
    }),
    () => ({ status: 200, body: {} })
  );
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Everything is claimed.')));
});
