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

// --- Set amounts (manual) through the real reducer state shape ---
import { reducer, initialState } from '../state/bill-reducer.js';
import { computeTotals } from '../../js/totals.js';
import { recomputeSplitTotals } from '../../api/_lib/recompute.js';

function manualState(values, payers = ['Ali', 'Bea']) {
  let s = { ...initialState, payers, parsed };
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  s = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'manual' });
  for (const [name, cents] of Object.entries(values)) {
    s = reducer(s, { type: 'SET_ITEM_MANUAL_VALUE', itemId: 'i1', name, text: String(cents / 100), cents });
  }
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i2' });
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i2', name: 'Ali', checked: false });
  return s;
}

test('manual state-shape: exact allocation is computed, not RM0', () => {
  const s = manualState({ Ali: 700, Bea: 300 });
  const { perPerson, itemizedSubtotalCents } = computeTotals(parsed.items, s.assignments, parsed, s.payers);
  assert.equal(perPerson.Ali.itemsCents, 700);
  assert.equal(perPerson.Bea.itemsCents, 300 + 400);
  assert.equal(itemizedSubtotalCents, 1400);
  assert.ok(perPerson.Ali.totalCents > 700);
});

test('manual state-shape: under-allocated counts only what was allocated', () => {
  const s = manualState({ Ali: 700, Bea: 100 });
  const { perPerson, itemizedSubtotalCents } = computeTotals(parsed.items, s.assignments, parsed, s.payers);
  assert.equal(perPerson.Ali.itemsCents, 700);
  assert.equal(perPerson.Bea.itemsCents, 100 + 400);
  assert.equal(itemizedSubtotalCents, 1200);
});

test('manual state-shape: over-allocated counts everything entered', () => {
  const s = manualState({ Ali: 800, Bea: 500 });
  const { perPerson, itemizedSubtotalCents } = computeTotals(parsed.items, s.assignments, parsed, s.payers);
  assert.equal(perPerson.Ali.itemsCents, 800);
  assert.equal(perPerson.Bea.itemsCents, 500 + 400);
  assert.equal(itemizedSubtotalCents, 1700);
});

test('manual state-shape: unknown payer is ignored', () => {
  const s = manualState({ Ali: 700, Ghost: 300 });
  const { perPerson } = computeTotals(parsed.items, s.assignments, parsed, s.payers);
  assert.equal(perPerson.Ali.itemsCents, 700);
  assert.equal(perPerson.Ghost, undefined);
  assert.equal(perPerson.Bea.itemsCents, 400);
});

test('manual split: POST body is non-zero, keeps the state shape, and the server recompute agrees', () => {
  const s = manualState({ Ali: 700, Bea: 300 });
  const body = buildSplitPayload({ parsed, payers: s.payers, assignments: s.assignments, ownerPaymentHandle: 'x' });
  assert.deepEqual(body.assignments, s.assignments);
  assert.equal(body.assignments.i1.manual.values.Ali.cents, 700);
  assert.ok(body.totals.per_person.Ali > 7);
  assert.ok(body.totals.per_person.Bea > 7);
  const r = recomputeSplitTotals(body);
  assert.equal(r.recomputed, true);
  assert.equal(r.mismatch, null);
  assert.deepEqual(r.totals.per_person, body.totals.per_person);
});
