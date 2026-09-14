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
import { computeTotals, toCents, fromCents, formatRM } from './totals.js';

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
