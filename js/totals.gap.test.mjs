// js/totals.gap.test.mjs
//
// The acknowledged difference on the receipt: grand total minus what the
// printed lines add up to, shared like service and tax. Amounts are integer
// cents inside; RM figures are used only to build the receipts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, reconcileReceipt, receiptGapCentsOf } from './totals.js';

const sumAll = (result) =>
  Object.values(result.perPerson).reduce((s, p) => s + p.totalCents, 0) + result.unclaimed.totalCents;

const PAYERS = ['A', 'B', 'C'];
const items = [
  { id: 'a', name: 'A', line_total: 10.01 },
  { id: 'b', name: 'B', line_total: 20.02 },
  { id: 'c', name: 'C', line_total: 30.03 },
];
const assign = { a: ['A'], b: ['B'], c: ['C'] };
// Lines come to 60.06 + 6.01 + 3.6 = 69.67 before any difference.
const baseBill = { subtotal: 60.06, service_charge: 6.01, tax: 3.6, discount: 0, rounding: 0 };

function withGap(gapCents) {
  const grand = (6006 + 601 + 360 + gapCents) / 100;
  return { ...baseBill, grand_total: grand };
}
const ticked = (bill, gapCents) => ({ ...bill, receipt_gap_cents: gapCents, receipt_gap_acknowledged: true });

for (const gap of [1, -1, 3, -100]) {
  test(`a difference of ${gap} sen: shares plus unclaimed add to the printed grand total`, () => {
    const bill = withGap(gap);
    assert.equal(reconcileReceipt(items, bill).differenceCents, gap);
    const r = computeTotals(items, assign, ticked(bill, gap), PAYERS);
    assert.equal(sumAll(r), Math.round(bill.grand_total * 100));
    const gapSum = PAYERS.reduce((s, n) => s + r.perPerson[n].gapCents, 0) + r.unclaimed.gapCents;
    assert.equal(gapSum, gap);
    const weights = [1001, 2002, 3003];
    PAYERS.forEach((n, i) => {
      const exact = (gap * weights[i]) / 6006;
      assert.ok(Math.abs(r.perPerson[n].gapCents - exact) < 1, `share of ${n} within 1 cent`);
    });
  });
}

test('three payers with equal weight and an odd difference: the odd sen goes to one person, none lost', () => {
  const eq = [
    { id: 'a', name: 'A', line_total: 10 },
    { id: 'b', name: 'B', line_total: 10 },
    { id: 'c', name: 'C', line_total: 10 },
  ];
  const bill = { subtotal: 30, service_charge: 0, tax: 0, discount: 0, rounding: 0, grand_total: 30.1 };
  const r = computeTotals(eq, assign, ticked(bill, 10), PAYERS);
  const gaps = PAYERS.map((n) => r.perPerson[n].gapCents).sort((x, y) => x - y);
  assert.deepEqual(gaps, [3, 3, 4]);
  assert.equal(sumAll(r), 3010);
});

test('an unclaimed item carries its part of the difference', () => {
  const bill = withGap(6);
  const r = computeTotals(items, { a: ['A'], b: ['B'] }, ticked(bill, 6), PAYERS);
  assert.equal(r.unclaimed.itemsCents, 3003);
  assert.equal(r.unclaimed.gapCents, 3);
  assert.equal(sumAll(r), Math.round(bill.grand_total * 100));
});

test('a person with weight 0 gets none of the difference', () => {
  const free = [...items, { id: 'z', name: 'Z', line_total: 5, discount: 5 }];
  const bill = withGap(7);
  const r = computeTotals(free, { ...assign, z: ['D'] }, ticked(bill, 7), [...PAYERS, 'D']);
  assert.equal(r.perPerson.D.itemsCents, 0);
  assert.equal(r.perPerson.D.gapCents, 0);
  assert.equal(r.perPerson.D.totalCents, 0);
  assert.equal(sumAll(r), Math.round(bill.grand_total * 100));
});

test('difference together with an item discount, a bill discount and rounding: every line stays within 1 cent', () => {
  const disc = [
    { id: 'a', name: 'A', line_total: 12.34, discount: 2.34 },
    { id: 'b', name: 'B', line_total: 20.02 },
    { id: 'c', name: 'C', line_total: 30.03 },
  ];
  const lines = 1000 + 2002 + 3003;
  const bill = { subtotal: 62.39, discount: 1.5, service_charge: 6, tax: 3.6, rounding: -0.02 };
  const gap = -5;
  bill.grand_total = (lines - 150 + 600 + 360 - 2 + gap) / 100;
  assert.equal(reconcileReceipt(disc, bill).differenceCents, gap);
  const r = computeTotals(disc, assign, ticked(bill, gap), PAYERS);
  assert.equal(sumAll(r), Math.round(bill.grand_total * 100));
  const weights = { A: 1000, B: 2002, C: 3003 };
  for (const [field, amount] of [
    ['discountCents', 150],
    ['serviceCents', 600],
    ['taxCents', 360],
    ['roundingCents', -2],
    ['gapCents', gap],
  ]) {
    for (const n of PAYERS) {
      const exact = (amount * weights[n]) / lines;
      assert.ok(Math.abs(r.perPerson[n][field] - exact) < 1, `${field} of ${n}`);
    }
  }
});

test('a difference that is not acknowledged is not shared', () => {
  const bill = { ...withGap(3), receipt_gap_cents: 3 };
  assert.equal(receiptGapCentsOf(bill), 0);
  const r = computeTotals(items, assign, bill, PAYERS);
  assert.equal('gapCents' in r.perPerson.A, false);
  assert.equal(sumAll(r), 6006 + 601 + 360);
  assert.equal(receiptGapCentsOf({ receipt_gap_acknowledged: true, receipt_gap_cents: 1.5 }), 0);
  assert.equal(receiptGapCentsOf(undefined), 0);
});

test('a bill with no difference gets no gap keys and the original arithmetic, with or without the marker fields', () => {
  let seed = 4242;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let run = 0; run < 400; run += 1) {
    const payers = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => `P${i}`);
    const list = [];
    const assignments = {};
    for (let i = 0; i < 1 + Math.floor(rand() * 6); i += 1) {
      list.push({ id: `i${i}`, name: `i${i}`, line_total: (1 + Math.floor(rand() * 9000)) / 100 });
      if (rand() < 0.8) assignments[`i${i}`] = payers.filter(() => rand() < 0.5);
    }
    const bill = {
      subtotal: 0,
      service_charge: Math.floor(rand() * 1500) / 100,
      tax: Math.floor(rand() * 1200) / 100,
      grand_total: 0,
    };
    const plain = computeTotals(list, assignments, bill, payers);
    const marked = computeTotals(
      list,
      assignments,
      { ...bill, receipt_gap_cents: 0, receipt_gap_acknowledged: true },
      payers
    );
    assert.deepEqual(marked, plain, `run ${run}`);
    for (const p of Object.values(plain.perPerson)) assert.equal('gapCents' in p, false);
    assert.equal('gapCents' in plain.unclaimed, false);
  }
});

test('property: with a difference, persons plus unclaimed equal the grand total and each share is within 1 cent', () => {
  let seed = 20261024;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let run = 0; run < 600; run += 1) {
    const payers = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => `P${i}`);
    const list = [];
    const assignments = {};
    for (let i = 0; i < 1 + Math.floor(rand() * 6); i += 1) {
      const gross = 1 + Math.floor(rand() * 9000);
      const disc = rand() < 0.3 ? Math.floor(rand() * (gross + 1)) : 0;
      list.push({ id: `i${i}`, name: `i${i}`, line_total: gross / 100, discount: disc / 100 });
      if (rand() < 0.85) assignments[`i${i}`] = payers.filter(() => rand() < 0.5);
    }
    const service = Math.floor(rand() * 1500);
    const tax = Math.floor(rand() * 1200);
    const rounding = rand() < 0.5 ? Math.floor(rand() * 9) - 4 : 0;
    const gap = rand() < 0.8 ? Math.floor(rand() * 301) - 150 : 0;
    const net = list.reduce((s, it) => s + Math.round(it.line_total * 100) - Math.round(it.discount * 100), 0);
    const grand = net + service + tax + rounding + gap;
    const bill = {
      subtotal: 0,
      discount: 0,
      service_charge: service / 100,
      tax: tax / 100,
      rounding: rounding / 100,
      grand_total: grand / 100,
    };
    assert.equal(reconcileReceipt(list, bill).differenceCents, gap);
    const r = computeTotals(list, assignments, gap ? ticked(bill, gap) : bill, payers);
    assert.equal(sumAll(r), grand, `run ${run}`);
    if (gap) {
      const slots = [...Object.values(r.perPerson), r.unclaimed];
      const weightTotal = slots.reduce((s, p) => s + p.itemsCents, 0);
      if (weightTotal > 0) {
        assert.equal(slots.reduce((s, p) => s + p.gapCents, 0), gap);
        for (const p of slots) {
          assert.ok(Math.abs(p.gapCents - (gap * p.itemsCents) / weightTotal) < 1, `run ${run}`);
          if (p.itemsCents === 0) assert.equal(p.gapCents, 0);
        }
      }
    }
  }
});
