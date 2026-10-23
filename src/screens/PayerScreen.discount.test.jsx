// src/screens/PayerScreen.discount.test.jsx — what a payer sees for a split that
// has item discounts, a bill discount and a rounding line, and that a split
// without them looks exactly as it did before.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/PayerScreen.discount.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PayerScreen from './PayerScreen.jsx';

const item = (id, name, total, discount) => ({
  id,
  name,
  category: 'food',
  qty: 1,
  unit_price: total,
  line_total: total,
  ...(discount === undefined ? {} : { discount }),
});

function split(totalsExtra = {}, itemsOverride, overrides = {}) {
  return {
    id: 's1',
    items: itemsOverride ?? [item('i1', 'Satay', 40, 8), item('i2', 'Rice', 60, 0)],
    assignments: {},
    totals: { subtotal: 100, service_charge: 9.2, tax: 0, grand_total: 101.2, per_person: {}, ...totalsExtra },
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

async function open(body) {
  mockGet(body);
  render(<PayerScreen id="s1" />);
  await waitFor(() => assert.ok(screen.getByText('Satay')));
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

test('an item with a discount shows its price and discount, and the net amount', async () => {
  await open(split());
  const line = screen.getAllByTestId('item-discount-line');
  assert.equal(line.length, 1);
  assert.match(line[0].textContent, /Price RM 40\.00 · Discount −RM 8\.00/);
  assert.ok(screen.getByText('RM32.00'));
  assert.equal(screen.queryByText('RM40.00'), null);
  assert.ok(screen.getByText('RM60.00'));
});

test('the bill Discount and Rounding lines show with their signs and the shared-by note', async () => {
  await open(split({ discount: 10, rounding: 0.01 }));
  const discount = screen.getByTestId('payer-discount-line');
  assert.match(discount.textContent, /Discount/);
  assert.match(discount.textContent, /−RM 10\.00/);
  assert.match(discount.textContent, /Discount, minus RM 10\.00/);
  assert.match(discount.textContent, /Shared by what each person ordered\./);
  const rounding = screen.getByTestId('payer-rounding-line');
  assert.match(rounding.textContent, /\+RM 0\.01/);
  assert.match(rounding.textContent, /Rounding, plus RM 0\.01/);
});

test('a negative rounding shows a minus', async () => {
  await open(split({ rounding: -0.02 }));
  assert.match(screen.getByTestId('payer-rounding-line').textContent, /−RM 0\.02/);
});

test('"(set by host)" shows only when the saved edited flag is set', async () => {
  await open(split({ rounding: 0.03, rounding_edited: true }));
  assert.ok(screen.getByText('Rounding (set by host)'));
  cleanup();
  await open(split({ rounding: 0.03 }));
  assert.ok(screen.getByText('Rounding'));
  assert.equal(screen.queryByText(/set by host\)/), null);
});

test('a split without discount or rounding shows no discount or rounding line anywhere', async () => {
  await open(split({}, [item('i1', 'Satay', 40), item('i2', 'Rice', 60)]));
  assert.equal(screen.queryByTestId('payer-discount-line'), null);
  assert.equal(screen.queryByTestId('payer-rounding-line'), null);
  assert.equal(screen.queryByTestId('item-discount-line'), null);
  assert.equal(screen.queryByText(/Discount/), null);
  assert.equal(screen.queryByText(/Rounding/), null);
  assert.ok(screen.getByText('RM40.00'));
});

test('zero values stored on the split are not shown either', async () => {
  await open(split({ discount: 0, rounding: 0 }, [item('i1', 'Satay', 40, 0), item('i2', 'Rice', 60, 0)]));
  assert.equal(screen.queryByTestId('payer-discount-line'), null);
  assert.equal(screen.queryByTestId('payer-rounding-line'), null);
  assert.equal(screen.queryByTestId('item-discount-line'), null);
});

test('the read-only view shows the same lines', async () => {
  await open(split({ discount: 10, rounding: 0.01 }, undefined, { payers: null }));
  assert.match(screen.getByTestId('item-discount-line').textContent, /Discount −RM 8\.00/);
  assert.ok(screen.getByTestId('payer-discount-line'));
  assert.ok(screen.getByTestId('payer-rounding-line'));
});

test("each person's total includes their share of the bill lines", async () => {
  // Two people, both on every item (equal split): item nets 32 + 60 = 92; discount 10, service 9.2, rounding +0.01.
  const assignments = { i1: ['Farah', 'Ben'], i2: ['Farah', 'Ben'] };
  await open(split({ discount: 10, rounding: 0.01, grand_total: 91.21 }, undefined, { assignments }));
  // 91.21 split between two equal weights: 45.61 and 45.60.
  await waitFor(() => assert.ok(screen.getAllByText('RM45.61').length >= 1));
  assert.ok(screen.getAllByText('RM45.60').length >= 1);
});
