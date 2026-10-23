// src/screens/PayerScreen.gap.test.jsx — the "Difference on receipt" line a
// payer sees when the host ticked that the paper receipt does not add up.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/PayerScreen.gap.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PayerScreen from './PayerScreen.jsx';

const item = (id, name, total) => ({
  id,
  name,
  category: 'food',
  qty: 1,
  unit_price: total,
  line_total: total,
  discount: 0,
});

// 40 + 60 + 9.2 = 109.20 before any difference. Two people, equal weight.
function split(grand, mark = {}, overrides = {}) {
  return {
    id: 's1',
    items: [item('i1', 'Satay', 40), item('i2', 'Rice', 60)],
    assignments: { i1: ['Farah', 'Ben'], i2: ['Farah', 'Ben'] },
    totals: {
      subtotal: 100,
      service_charge: 9.2,
      tax: 0,
      discount: 0,
      rounding: 0,
      grand_total: grand,
      per_person: {},
      ...mark,
    },
    payers: ['Farah', 'Ben'],
    version: 0,
    ownerPaymentHandle: 'DuitNow: 012-3456789',
    createdAt: new Date().toISOString(),
    merchant_name: null,
    receipt_date: null,
    ...overrides,
  };
}

async function open(body) {
  global.fetch = async () => ({ ok: true, status: 200, json: async () => body });
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

const mark = (cents) => ({ receipt_gap_cents: cents, receipt_gap_acknowledged: true });
const line = () => screen.queryByTestId('payer-difference-line');

test('a difference that adds: signed +, spoken "plus", the helper, and totals that add to the printed total', async () => {
  await open(split(109.23, mark(3)));
  assert.match(line().textContent, /Difference on receipt/);
  assert.match(line().textContent, /\+RM 0\.03/);
  assert.match(line().textContent, /Difference on receipt, plus RM 0\.03/);
  assert.match(line().textContent, /The printed total differs from the printed lines by this amount\. Shared by what each person ordered\./);
  // 109.23 shared by two equal people: 54.62 and 54.61 (the odd sen goes to one of them).
  await waitFor(() => assert.ok(screen.getAllByText('RM54.62').length >= 1));
  assert.ok(screen.getAllByText('RM54.61').length >= 1);
});

test('a difference that takes off: signed minus, spoken "minus"', async () => {
  await open(split(109.17, mark(-3)));
  assert.match(line().textContent, /−RM 0\.03/);
  assert.match(line().textContent, /Difference on receipt, minus RM 0\.03/);
  await waitFor(() => assert.ok(screen.getAllByText('RM54.59').length >= 1));
  assert.ok(screen.getAllByText('RM54.58').length >= 1);
});

test('no "(set by host)" or edited tag on the difference line', async () => {
  await open(split(109.23, mark(3)));
  assert.doesNotMatch(line().textContent, /set by host|Edited by you/i);
  assert.equal(screen.queryByText(/set by host\)/), null);
  assert.equal(screen.queryByTestId('payer-rounding-line'), null);
});

test('no difference on the split: the payer view has no such line, no marker text, no badge', async () => {
  await open(split(109.2));
  assert.equal(line(), null);
  assert.equal(screen.queryByText(/Difference on receipt/), null);
  assert.equal(screen.queryByTestId('payer-discount-line'), null);
  assert.equal(screen.queryByTestId('payer-rounding-line'), null);
});

test('a stored zero difference, or a marker that was never acknowledged, shows nothing', async () => {
  await open(split(109.2, { receipt_gap_cents: 0, receipt_gap_acknowledged: true }));
  assert.equal(line(), null);
  cleanup();
  await open(split(109.2, { receipt_gap_cents: 3 }));
  assert.equal(line(), null);
});

test('the difference shows beside Rounding, after it, and neither is mixed up with the other', async () => {
  await open(split(109.26, { rounding: 0.01, ...mark(2) }));
  const rounding = screen.getByTestId('payer-rounding-line');
  assert.match(rounding.textContent, /\+RM 0\.01/);
  assert.match(line().textContent, /\+RM 0\.02/);
  assert.equal(rounding.compareDocumentPosition(line()) & 4, 4, 'the difference line follows the rounding line');
});

test('the read-only view shows the same line', async () => {
  await open(split(109.23, mark(3), { payers: null, totals: { ...split(109.23, mark(3)).totals, per_person: { Farah: 54.62, Ben: 54.61 } } }));
  assert.match(line().textContent, /\+RM 0\.03/);
});
