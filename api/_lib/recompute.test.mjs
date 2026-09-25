// api/_lib/recompute.test.mjs — server recomputation of per-person figures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recomputeSplitTotals } = require('./recompute.js');
const { computeTotals } = require('./totals.js');

function body(overrides = {}) {
  return {
    items: [
      { id: 'i1', name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 10, line_total: 10 },
      { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 4, line_total: 4 },
    ],
    assignments: { i1: ['Ali', 'Bea'], i2: ['Bea'] },
    payers: ['Ali', 'Bea'],
    totals: { subtotal: 14, service_charge: 1.4, tax: 0.84, grand_total: 16.24, per_person: {} },
    ownerPaymentHandle: 'x',
    ...overrides,
  };
}

function honestPerPerson(b) {
  const { perPerson } = computeTotals(b.items, b.assignments, b.totals, b.payers);
  return Object.fromEntries(Object.entries(perPerson).map(([n, p]) => [n, p.totalCents / 100]));
}

test('honest client figures: no mismatch, same figures stored', () => {
  const b = body();
  b.totals.per_person = honestPerPerson(b);
  const r = recomputeSplitTotals(b);
  assert.equal(r.recomputed, true);
  assert.equal(r.source, 'client');
  assert.equal(r.mismatch, null);
  assert.deepEqual(r.totals.per_person, b.totals.per_person);
});

test('altered client figures: server figures stored, mismatch reported by position', () => {
  const b = body();
  b.totals.per_person = { Ali: 0.01, Bea: 0.01 };
  const r = recomputeSplitTotals(b);
  assert.deepEqual(r.totals.per_person, honestPerPerson(body()));
  assert.equal(r.mismatch.diffs.length, 2);
  assert.equal(r.mismatch.diffs[0].index, 0);
  assert.equal(r.mismatch.diffs[0].client, 1);
  assert.equal(r.mismatch.diffs[0].server, r.totals.per_person.Ali * 100);
  assert.ok(!JSON.stringify(r.mismatch).includes('Ali'), 'no payer names in the mismatch detail');
});

test('non-per_person totals fields are stored exactly as sent', () => {
  const b = body();
  b.totals.per_person = { Ali: 99, Bea: 99 };
  const { totals } = recomputeSplitTotals(b);
  assert.equal(totals.subtotal, 14);
  assert.equal(totals.tax, 0.84);
  assert.equal(totals.service_charge, 1.4);
  assert.equal(totals.grand_total, 16.24);
});

test('a missing client figure for a payer counts as a mismatch', () => {
  const b = body();
  b.totals.per_person = { Ali: honestPerPerson(b).Ali };
  const r = recomputeSplitTotals(b);
  assert.equal(r.mismatch.diffs.length, 1);
  assert.equal(r.mismatch.diffs[0].client, null);
});

test('a client figure for a name not in payers counts as a mismatch', () => {
  const b = body();
  b.totals.per_person = { ...honestPerPerson(b), Ghost: 5 };
  const r = recomputeSplitTotals(b);
  assert.equal(r.mismatch.extraClient, 1);
  assert.equal(r.mismatch.diffs.length, 0);
});

test('payers absent: falls back to per_person keys', () => {
  const b = body();
  b.totals.per_person = honestPerPerson(b);
  delete b.payers;
  const r = recomputeSplitTotals(b);
  assert.equal(r.source, 'per_person');
  assert.equal(r.recomputed, true);
  assert.equal(r.mismatch, null);
});

test('payers and per_person both absent: client totals stored unchanged', () => {
  const b = body();
  delete b.payers;
  delete b.totals.per_person;
  const r = recomputeSplitTotals(b);
  assert.equal(r.recomputed, false);
  assert.equal(r.source, 'none');
  assert.equal(r.totals, b.totals);
});

test('a computation failure never throws: client totals kept', () => {
  const b = body({ items: null });
  const r = recomputeSplitTotals(b);
  assert.equal(r.recomputed, false);
  assert.equal(r.source, 'error');
  assert.equal(r.totals, b.totals);
});
