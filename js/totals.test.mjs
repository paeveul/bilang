// js/totals.test.mjs
//
// Tests for js/totals.js — the only place money is actually computed in
// Bilang. Pure functions, no DOM, no network, so this runs directly under
// Node's built-in test runner: `node --test js/` (see package.json "test"
// script). No test framework dependency needed for six cases.
//
// Run: npm test  (or: node --test js/totals.test.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTotals,
  toCents,
  fromCents,
  formatRM,
  formatRMLocked,
  percentToCents,
  centsToPercent,
  manualItemRemainingCents,
} from './totals.js';

function sumPerPersonTotals(perPerson) {
  return Object.values(perPerson).reduce((sum, p) => sum + p.totalCents, 0);
}

test('simple even split — 2 people, shared items, sums to the cent', () => {
  const items = [
    { id: 'i1', name: 'Fried Rice', qty: 1, unit_price: 10, line_total: 10 },
    { id: 'i2', name: 'Teh Tarik', qty: 2, unit_price: 3, line_total: 6 },
  ];
  const assignments = { i1: ['Alex', 'Bee'], i2: ['Alex', 'Bee'] };
  const billTotals = { subtotal: 16, service_charge: 0, tax: 0, grand_total: 16 };
  const payers = ['Alex', 'Bee'];

  const result = computeTotals(items, assignments, billTotals, payers);

  assert.equal(result.itemizedSubtotalCents, 1600);
  assert.equal(result.perPerson.Alex.itemsCents, 800);
  assert.equal(result.perPerson.Bee.itemsCents, 800);
  assert.equal(sumPerPersonTotals(result.perPerson), 1600);
  assert.equal(result.reconciliation.matches, true);
});

test('largest-remainder distribution — 3 people splitting an amount that does not divide evenly', () => {
  // RM10.01 -> 1001 cents / 3 = 333 remainder 2 -> two payers get 334, one gets 333.
  const items = [
    { id: 'i1', name: 'Shared Platter', qty: 1, unit_price: 10.01, line_total: 10.01 },
  ];
  const assignments = { i1: ['A', 'B', 'C'] };
  const billTotals = { subtotal: 10.01, service_charge: 0, tax: 0, grand_total: 10.01 };
  const payers = ['A', 'B', 'C'];

  const result = computeTotals(items, assignments, billTotals, payers);

  const shares = payers.map((p) => result.perPerson[p].itemsCents).sort((a, b) => a - b);
  assert.deepEqual(shares, [333, 334, 334]);
  // No cent lost or invented: shares sum exactly to the line total.
  assert.equal(shares.reduce((a, b) => a + b, 0), 1001);
  assert.equal(sumPerPersonTotals(result.perPerson), 1001);
});

test('tax/service charge apportioned pro-rata by assigned-item share, not stated subtotal', () => {
  // A ordered RM30 of items, B ordered RM10 — a 3:1 ratio. The receipt's
  // stated subtotal is deliberately different (RM50) to prove apportionment
  // follows the itemized assignment, not billTotals.subtotal.
  const items = [
    { id: 'i1', name: 'Steak', qty: 1, unit_price: 30, line_total: 30 },
    { id: 'i2', name: 'Salad', qty: 1, unit_price: 10, line_total: 10 },
  ];
  const assignments = { i1: ['A'], i2: ['B'] };
  const billTotals = { subtotal: 50, service_charge: 4, tax: 2.4, grand_total: 46.4 };
  const payers = ['A', 'B'];

  const result = computeTotals(items, assignments, billTotals, payers);

  // itemized subtotal is 40 (30+10), not the stated 50.
  assert.equal(result.itemizedSubtotalCents, 4000);
  // A has 3/4 share, B has 1/4 share of tax (240c) and service (400c).
  assert.equal(result.perPerson.A.taxCents, 180);
  assert.equal(result.perPerson.B.taxCents, 60);
  assert.equal(result.perPerson.A.serviceCents, 300);
  assert.equal(result.perPerson.B.serviceCents, 100);
  // Reconciliation correctly flags the mismatch against the stated subtotal.
  assert.equal(result.reconciliation.matches, false);
});

test('reconciliation.matches — true within 1-cent tolerance, false outside it', () => {
  const items = [{ id: 'i1', name: 'Item', qty: 1, unit_price: 10, line_total: 10 }];
  const assignments = { i1: ['A'] };
  const payers = ['A'];

  const withinTolerance = computeTotals(
    items,
    assignments,
    { subtotal: 10.01, service_charge: 0, tax: 0, grand_total: 10.01 },
    payers
  );
  assert.equal(withinTolerance.reconciliation.matches, true);

  const outsideTolerance = computeTotals(
    items,
    assignments,
    { subtotal: 10.02, service_charge: 0, tax: 0, grand_total: 10.02 },
    payers
  );
  assert.equal(outsideTolerance.reconciliation.matches, false);
});

test('an item with no one assigned to it is excluded from all totals', () => {
  const items = [
    { id: 'i1', name: 'Assigned Item', qty: 1, unit_price: 10, line_total: 10 },
    { id: 'i2', name: 'Unassigned Item', qty: 1, unit_price: 999, line_total: 999 },
  ];
  const assignments = { i1: ['A'], i2: [] };
  const billTotals = { subtotal: 10, service_charge: 0, tax: 0, grand_total: 10 };
  const payers = ['A'];

  const result = computeTotals(items, assignments, billTotals, payers);

  assert.equal(result.itemizedSubtotalCents, 1000);
  assert.equal(result.perPerson.A.itemsCents, 1000);
  assert.equal(result.reconciliation.matches, true);
});

test('edge case — item assigned to nobody AND a payer with zero items gets 0 tax/service share (no divide-by-zero)', () => {
  const items = [
    { id: 'i1', name: 'A Item', qty: 1, unit_price: 20, line_total: 20 },
    { id: 'i2', name: 'Nobody Item', qty: 1, unit_price: 5, line_total: 5 },
  ];
  const assignments = { i1: ['A'], i2: [] };
  const billTotals = { subtotal: 20, service_charge: 2, tax: 1, grand_total: 23 };
  const payers = ['A', 'B']; // B has zero items assigned

  const result = computeTotals(items, assignments, billTotals, payers);

  assert.equal(result.perPerson.B.itemsCents, 0);
  assert.equal(result.perPerson.B.taxCents, 0);
  assert.equal(result.perPerson.B.serviceCents, 0);
  assert.equal(result.perPerson.B.totalCents, 0);
  // A gets the full tax + service since A is the only payer with items.
  assert.equal(result.perPerson.A.taxCents, 100);
  assert.equal(result.perPerson.A.serviceCents, 200);
  assert.equal(sumPerPersonTotals(result.perPerson), 2000 + 100 + 200);
});

test('helper functions — toCents, fromCents, formatRM basic behaviour', () => {
  assert.equal(toCents(10.005), 1001); // rounds to nearest cent
  assert.equal(toCents(undefined), 0);
  assert.equal(fromCents(1050), 10.5);
  assert.equal(formatRM(10.5), 'RM10.50');
  assert.equal(formatRM(undefined), 'RM0.00');
});

// ---------------------------------------------------------------------------
// Item 22 Step 8 — manual per-person override mode (§5.1.1). These tests
// specifically target the computeTotals() extension described in that
// file's own header: existing equal-split behaviour (all tests above) must
// stay byte-for-byte unchanged, and the new manual-mode path needs its own
// hard coverage since it's real money math, not a display change.
// ---------------------------------------------------------------------------

test('manual mode — exact allocation sums correctly and matches the equal-split call shape', () => {
  const items = [{ id: 'i1', name: 'Satay', qty: 1, unit_price: 10.53, line_total: 10.53 }];
  const assignments = {
    i1: { mode: 'manual', amounts: { Farah: 100, 'Wei Jie': 953 } }, // RM1.00 + RM9.53 = RM10.53
  };
  const billTotals = { subtotal: 10.53, service_charge: 0, tax: 0, grand_total: 10.53 };
  const payers = ['Farah', 'Wei Jie'];

  const result = computeTotals(items, assignments, billTotals, payers);

  assert.equal(result.perPerson.Farah.itemsCents, 100);
  assert.equal(result.perPerson['Wei Jie'].itemsCents, 953);
  assert.equal(result.itemizedSubtotalCents, 1053);
  assert.equal(sumPerPersonTotals(result.perPerson), 1053);
  assert.equal(result.reconciliation.matches, true);
});

test('manual mode — under-allocated item is represented honestly (sum of what was typed, not the nominal line_total)', () => {
  // Creator ticked 2 people, typed one value (RM3.00), left the other
  // blank/unset — per §5.1.1 point 4, an unset value contributes RM0.00,
  // never a silently-invented "whoever's left" remainder.
  const items = [{ id: 'i1', name: 'Item', qty: 1, unit_price: 12, line_total: 12 }];
  const assignments = { i1: { mode: 'manual', amounts: { A: 300 } } }; // B has no entry at all
  const billTotals = { subtotal: 12, service_charge: 0, tax: 0, grand_total: 12 };
  const payers = ['A', 'B'];

  const result = computeTotals(items, assignments, billTotals, payers);

  assert.equal(result.perPerson.A.itemsCents, 300);
  assert.equal(result.perPerson.B.itemsCents, 0);
  // The itemized subtotal reflects the RM3.00 actually allocated, NOT the
  // item's RM12.00 line_total — this is the money that's actually in
  // perPerson, and this function must never claim more than that exists.
  assert.equal(result.itemizedSubtotalCents, 300);
});

test('manual mode — over-allocated item still sums exactly what was typed (no capping, no silent correction)', () => {
  const items = [{ id: 'i1', name: 'Item', qty: 1, unit_price: 10, line_total: 10 }];
  const assignments = { i1: { mode: 'manual', amounts: { A: 700, B: 700 } } }; // RM14.00 typed against a RM10.00 item
  const billTotals = { subtotal: 10, service_charge: 0, tax: 0, grand_total: 10 };
  const payers = ['A', 'B'];

  const result = computeTotals(items, assignments, billTotals, payers);

  assert.equal(result.perPerson.A.itemsCents, 700);
  assert.equal(result.perPerson.B.itemsCents, 700);
  assert.equal(result.itemizedSubtotalCents, 1400);
});

test('manual mode — zero, negative, non-finite and unknown-payer amounts are all ignored, not zeroed-and-counted', () => {
  const items = [{ id: 'i1', name: 'Item', qty: 1, unit_price: 10, line_total: 10 }];
  const assignments = {
    i1: {
      mode: 'manual',
      amounts: { A: 1000, B: 0, C: -50, D: NaN, Ghost: 500 }, // Ghost is not in `payers`
    },
  };
  const billTotals = { subtotal: 10, service_charge: 0, tax: 0, grand_total: 10 };
  const payers = ['A', 'B', 'C', 'D'];

  const result = computeTotals(items, assignments, billTotals, payers);

  assert.equal(result.perPerson.A.itemsCents, 1000);
  assert.equal(result.perPerson.B.itemsCents, 0);
  assert.equal(result.perPerson.C.itemsCents, 0);
  assert.equal(result.perPerson.D.itemsCents, 0);
  assert.equal(result.itemizedSubtotalCents, 1000); // only A's RM10.00 counted
});

test('equal mode via the new { mode: "equal", equal: [...] } wrapper produces identical output to the legacy plain array', () => {
  const items = [
    { id: 'i1', name: 'Fried Rice', qty: 1, unit_price: 10, line_total: 10 },
    { id: 'i2', name: 'Teh Tarik', qty: 2, unit_price: 3, line_total: 6 },
  ];
  const billTotals = { subtotal: 16, service_charge: 0, tax: 0, grand_total: 16 };
  const payers = ['Alex', 'Bee'];

  const legacy = computeTotals(items, { i1: ['Alex', 'Bee'], i2: ['Alex', 'Bee'] }, billTotals, payers);
  const wrapped = computeTotals(
    items,
    { i1: { mode: 'equal', equal: ['Alex', 'Bee'] }, i2: { mode: 'equal', equal: ['Alex', 'Bee'] } },
    billTotals,
    payers
  );

  assert.deepEqual(wrapped.perPerson, legacy.perPerson);
  assert.equal(wrapped.itemizedSubtotalCents, legacy.itemizedSubtotalCents);
});

test('mixed bill — one item equal-split, one item manual override, in the same computeTotals() call', () => {
  const items = [
    { id: 'i1', name: 'Shared Nasi Lemak', qty: 2, unit_price: 5, line_total: 10 }, // equal split
    { id: 'i2', name: 'Farah had a sip', qty: 1, unit_price: 10.53, line_total: 10.53 }, // manual
  ];
  const assignments = {
    i1: ['A', 'B'],
    i2: { mode: 'manual', amounts: { A: 100, B: 953 } },
  };
  const billTotals = { subtotal: 20.53, service_charge: 0, tax: 0, grand_total: 20.53 };
  const payers = ['A', 'B'];

  const result = computeTotals(items, assignments, billTotals, payers);

  // i1: RM10 / 2 = RM5 each. i2: A=RM1.00, B=RM9.53.
  assert.equal(result.perPerson.A.itemsCents, 500 + 100);
  assert.equal(result.perPerson.B.itemsCents, 500 + 953);
  assert.equal(result.itemizedSubtotalCents, 1000 + 1053);
  assert.equal(result.reconciliation.matches, true);
});

test('percentToCents — basic conversion and rounding', () => {
  // 20% of RM10.53 = 210.6 cents -> rounds to 211.
  assert.equal(percentToCents(20, 10.53), 211);
  // 50% of RM10.53 = 526.5 -> banker's-neutral Math.round rounds half up to 527.
  assert.equal(percentToCents(50, 10.53), 527);
  assert.equal(percentToCents(100, 10.53), 1053);
  assert.equal(percentToCents(0, 10.53), 0);
  assert.equal(percentToCents(undefined, 10.53), 0);
  assert.equal(percentToCents('not a number', 10.53), 0);
});

test('centsToPercent — display-only inverse, rounded to one decimal place, and never divides by zero', () => {
  assert.equal(centsToPercent(211, 10.53), 20); // 211/1053*100 = 20.0379... -> 20.0
  assert.equal(centsToPercent(100, 10.53), 9.5); // 100/1053*100 = 9.4967... -> 9.5
  assert.equal(centsToPercent(1053, 10.53), 100);
  assert.equal(centsToPercent(500, 0), 0); // zero line_total -> 0, no divide-by-zero throw
});

test('percentToCents -> centsToPercent round trip never breaks the exact-match check (the stored cents value is always authoritative)', () => {
  // A creator types 33% against a RM10.53 item. The resolved stored cents
  // value is what the submit-time sum must use — never a re-derivation
  // through the display percentage, which would introduce drift.
  const storedCents = percentToCents(33, 10.53);
  assert.equal(storedCents, 347); // 33% of 1053 = 347.49 -> rounds to 347
  // Converting back for display happens to read exactly "33" again here —
  // that's not guaranteed in general (rounding is a one-way street through
  // cents), it's just what this particular pair of numbers produces. The
  // guarantee §5.1.1 point 7 actually makes is the one below: whatever the
  // display shows, the STORED cents value is what the block checks.
  const displayPercent = centsToPercent(storedCents, 10.53);
  assert.equal(displayPercent, 33);
});

test('manualItemRemainingCents — under, over, exact, and non-manual assignments', () => {
  const item = { id: 'i1', name: 'Item', qty: 1, unit_price: 10.53, line_total: 10.53 };

  const under = { mode: 'manual', manual: { unit: 'RM', values: { A: { text: '1.00', cents: 100 } } } };
  assert.equal(manualItemRemainingCents(item, under), 953); // RM9.53 still to allocate

  const over = {
    mode: 'manual',
    manual: { unit: 'RM', values: { A: { text: '20.00', cents: 2000 } } },
  };
  assert.equal(manualItemRemainingCents(item, over), -947); // RM9.47 over (negative = over)

  const exact = {
    mode: 'manual',
    manual: {
      unit: 'RM',
      values: { A: { text: '1.00', cents: 100 }, B: { text: '9.53', cents: 953 } },
    },
  };
  assert.equal(manualItemRemainingCents(item, exact), 0);

  // Equal-split assignments (either shape) never carry a remainder — the
  // largest-remainder method guarantees exact resolution by construction.
  assert.equal(manualItemRemainingCents(item, ['A', 'B']), 0);
  assert.equal(manualItemRemainingCents(item, { mode: 'equal', equal: ['A', 'B'] }), 0);
  assert.equal(manualItemRemainingCents(item, undefined), 0);
});

test('formatRMLocked — Tony\'s locked-copy spacing ("RM 1.00"), distinct from formatRM\'s existing no-space convention ("RM1.00")', () => {
  assert.equal(formatRMLocked(1), 'RM 1.00');
  assert.equal(formatRMLocked(0.3), 'RM 0.30');
  assert.equal(formatRM(1), 'RM1.00'); // unchanged, still used everywhere else in the app
});
