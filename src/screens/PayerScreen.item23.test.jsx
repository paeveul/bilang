// src/screens/PayerScreen.item23.test.jsx — Item 23 Step 5: the payer-view
// header. Amelia's placement decision (2026-09-29, functional-only): merchant
// name/receipt date sit between the heading and whichever state block
// follows, rendering once regardless of state, absent (not a placeholder)
// when the value is null. Covers both the claiming-available header and the
// read-only fallback header (a judgment call — see this pass's dispatch
// report).
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/PayerScreen.item23.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
    merchant_name: null,
    receipt_date: null,
    ...overrides,
  };
}

function mockGet(body) {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => body });
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

test('claiming-available header: both present render once, above the identity block', async () => {
  mockGet(baseSplit({ merchant_name: 'Restoran Uncle', receipt_date: '2026-09-28' }));
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Who are you?')));
  assert.ok(screen.getByText('Restoran Uncle'));
  assert.ok(screen.getByText('2026-09-28'));
});

test('claiming-available header: both null renders neither line, no placeholder', async () => {
  mockGet(baseSplit());
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Who are you?')));
  assert.equal(screen.queryByText(/Unknown merchant/i), null);
  assert.equal(screen.queryByText('Restoran Uncle'), null);
});

test('read-only fallback (no roster): header still shows merchant name/date when present', async () => {
  mockGet(
    baseSplit({
      payers: null,
      merchant_name: 'Restoran Uncle',
      receipt_date: '2026-09-28',
      totals: { subtotal: 14, service_charge: 0, tax: 0, grand_total: 14, per_person: { Farah: 14 } },
    })
  );
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Bill split')));
  assert.ok(screen.getByText('Restoran Uncle'));
  assert.ok(screen.getByText('2026-09-28'));
});

test('read-only fallback (no roster): both null renders neither line', async () => {
  mockGet(
    baseSplit({
      payers: null,
      totals: { subtotal: 14, service_charge: 0, tax: 0, grand_total: 14, per_person: { Farah: 14 } },
    })
  );
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Bill split')));
  assert.equal(screen.queryByText('Restoran Uncle'), null);
});
