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

test('unclaimed items: stored totals carry unclaimed and unclaimed_items; nobody charged for them', () => {
  const b = body({ assignments: { i1: ['Ali', 'Bea'] } }); // i2 (4.00) nobody yet
  const r = recomputeSplitTotals(b);
  assert.equal(r.totals.unclaimed_items, 4);
  assert.equal(r.totals.unclaimed, 4.64);
  const sum = Object.values(r.totals.per_person).reduce((a, c) => a + c, 0);
  assert.equal(Math.round((sum + r.totals.unclaimed) * 100), 1624);
});

test('all-assigned bill: unclaimed is 0 and per-person figures are unchanged', () => {
  const b = body();
  const r = recomputeSplitTotals(b);
  assert.equal(r.totals.unclaimed, 0);
  assert.equal(r.totals.unclaimed_items, 0);
  assert.deepEqual(r.totals.per_person, honestPerPerson(b));
});

test('per_person fallback: a hostile per_person key never becomes a payer or leaks into stored figures', () => {
  const before = JSON.stringify([Object.keys(Object.prototype), Object.itemsCents]);
  const perPerson = JSON.parse('{"Ali": 5.5, "Bea": 10.74}');
  const b = body({ payers: undefined, totals: { ...body().totals, per_person: perPerson } });
  delete b.payers;
  const out = recomputeSplitTotals(b);
  assert.deepEqual(Object.keys(out.totals.per_person), ['Ali', 'Bea']);

  // Roster ['Ali'] plus a host-sent assignment naming 'constructor': same figures as unassigned.
  const r1 = recomputeSplitTotals(body({ payers: ['Ali'], assignments: { i1: ['constructor'] }, totals: { ...body().totals, per_person: {} } }));
  const r2 = recomputeSplitTotals(body({ payers: ['Ali'], assignments: {}, totals: { ...body().totals, per_person: {} } }));
  assert.equal(JSON.stringify(r1.totals), JSON.stringify(r2.totals));
  assert.deepEqual(Object.keys(r1.totals.per_person), ['Ali']);
  assert.equal(JSON.stringify([Object.keys(Object.prototype), Object.itemsCents]), before);
});

test('per_person fallback with reserved keys: they are not payers, stored per_person is exactly the real names as own keys', () => {
  const hostile = JSON.parse('{"__proto__": 1, "constructor": 3, "Ali": 2}');
  const b = body({ totals: { ...body().totals, per_person: hostile } });
  delete b.payers;
  const out = recomputeSplitTotals(b);
  assert.equal(out.source, 'per_person');
  assert.deepEqual(Object.keys(out.totals.per_person), ['Ali']);
  assert.equal(Object.getPrototypeOf(out.totals.per_person), Object.prototype);
  assert.equal(JSON.stringify(Object.keys(JSON.parse(JSON.stringify(out.totals.per_person)))), '["Ali"]');
});
