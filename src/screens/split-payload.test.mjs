// src/screens/split-payload.test.mjs — the POST /api/split body the client builds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSplitPayload } from './split-payload.js';

const parsed = {
  items: [
    { id: 'i1', name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 10, line_total: 10 },
    { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 4, line_total: 4 },
  ],
  subtotal: 14,
  service_charge: 1.4,
  tax: 0.84,
  grand_total: 16.24,
};
const assignments = { i1: ['Ali', 'Bea'], i2: ['Bea'] };

test('payload carries the ordered payers list', () => {
  const body = buildSplitPayload({
    parsed,
    payers: ['Bea', 'Ali'],
    assignments,
    ownerPaymentHandle: 'DuitNow 012',
  });
  assert.deepEqual(body.payers, ['Bea', 'Ali']);
  assert.deepEqual(Object.keys(body.totals.per_person), ['Bea', 'Ali']);
  assert.equal(body.ownerPaymentHandle, 'DuitNow 012');
});

test('payers is a copy, not the live state array', () => {
  const payers = ['Ali', 'Bea'];
  const body = buildSplitPayload({ parsed, payers, assignments, ownerPaymentHandle: 'x' });
  assert.notEqual(body.payers, payers);
});

test('per_person preview sums to the receipt figures', () => {
  const body = buildSplitPayload({
    parsed,
    payers: ['Ali', 'Bea'],
    assignments,
    ownerPaymentHandle: 'x',
  });
  const sum = Object.values(body.totals.per_person).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 100), Math.round(parsed.grand_total * 100));
  assert.equal(body.totals.grand_total, parsed.grand_total);
});
