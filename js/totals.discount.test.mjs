// js/totals.discount.test.mjs
//
// Receipt discounts and rounding: the exact reconcile and the share
// maths. Amounts are integer cents inside; RM figures are used only to build
// the receipts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTotals,
  reconcileReceipt,
  normalizeScanDiscounts,
  hasDiscountFields,
  manualItemRemainingCents,
} from './totals.js';

const sumAll = (result) =>
  Object.values(result.perPerson).reduce((s, p) => s + p.totalCents, 0) + result.unclaimed.totalCents;
const totalsOf = (result, payers) => payers.map((n) => result.perPerson[n].totalCents);

// Worked example A: bill discount + rounding, 3 payers.
const itemsA = [
  { id: 'a', name: 'A', line_total: 50 },
  { id: 'b', name: 'B', line_total: 30 },
  { id: 'c', name: 'C', line_total: 20 },
];
const billA = { subtotal: 100, discount: 10, service_charge: 9, tax: 5.94, rounding: 0.01, grand_total: 104.95 };
const assignA = { a: ['A'], b: ['B'], c: ['C'] };

// Worked example B: item-specific discount.
const itemsB = [
  { id: 'x', name: 'X', line_total: 40, discount: 8 },
  { id: 'y', name: 'Y', line_total: 60 },
];
const billB = { subtotal: 100, discount: 0, service_charge: 9.2, tax: 0, rounding: 0, grand_total: 101.2 };
const assignB = { x: ['A'], y: ['B', 'C'] };

test('example A: shares 52.48 / 31.48 / 20.99 = 104.95', () => {
  const r = computeTotals(itemsA, assignA, billA, ['A', 'B', 'C']);
  assert.deepEqual(totalsOf(r, ['A', 'B', 'C']), [5248, 3148, 2099]);
  assert.equal(sumAll(r), 10495);
  assert.equal(reconcileReceipt(itemsA, billA).matches, true);
});

test('example B: shares 35.20 / 33.00 / 33.00 = 101.20, only A gets the item discount', () => {
  const r = computeTotals(itemsB, assignB, billB, ['A', 'B', 'C']);
  assert.deepEqual(totalsOf(r, ['A', 'B', 'C']), [3520, 3300, 3300]);
  assert.equal(sumAll(r), 10120);
  assert.equal(reconcileReceipt(itemsB, billB).matches, true);
  // Without the discount B and C would pay the same: their bill is untouched by A's discount.
  assert.equal(r.perPerson.B.itemsCents, 3000);
});

test('single payer owning all items pays the grand total exactly', () => {
  const r = computeTotals(itemsA, { a: ['Solo'], b: ['Solo'], c: ['Solo'] }, billA, ['Solo']);
  assert.equal(r.perPerson.Solo.totalCents, 10495);
  const rb = computeTotals(itemsB, { x: ['Solo'], y: ['Solo'] }, billB, ['Solo']);
  assert.equal(rb.perPerson.Solo.totalCents, 10120);
});

test('unclaimed items carry their share of discount, service, tax and rounding', () => {
  const r = computeTotals(itemsA, { a: ['A'], b: ['B'] }, billA, ['A', 'B', 'C']);
  assert.equal(r.unclaimed.itemsCents, 2000);
  assert.equal(r.unclaimed.discountCents, 200);
  assert.equal(r.unclaimed.totalCents, 2099); // what C would have paid
  assert.equal(sumAll(r), 10495);
  assert.equal(r.perPerson.C.totalCents, 0);
});

test('unclaimed with an item discount only (no bill discount / rounding)', () => {
  const r = computeTotals(itemsB, { x: ['A'] }, billB, ['A', 'B', 'C']);
  assert.equal(r.unclaimed.itemsCents, 6000);
  assert.equal(sumAll(r), 10120);
});

test('a discount equal to its item gives net 0 and adds no weight', () => {
  const items = [
    { id: 'free', name: 'Free', line_total: 12, discount: 12 },
    { id: 'p', name: 'P', line_total: 10 },
  ];
  const bill = { subtotal: 22, discount: 0, service_charge: 1, tax: 0.6, rounding: 0, grand_total: 11.6 };
  const r = computeTotals(items, { free: ['A'], p: ['B'] }, bill, ['A', 'B']);
  assert.equal(r.perPerson.A.itemsCents, 0);
  assert.equal(r.perPerson.A.totalCents, 0);
  assert.equal(r.perPerson.B.totalCents, 1160);
  assert.equal(reconcileReceipt(items, bill).matches, true);
});

test('a discount greater than its item is an error, not a silent pass', () => {
  const items = [{ id: 'p', name: 'P', line_total: 10, discount: 12 }];
  const bill = { subtotal: 10, discount: 0, service_charge: 0, tax: 0, rounding: 0, grand_total: -2 };
  const rec = reconcileReceipt(items, bill);
  assert.equal(rec.matches, false);
  assert.deepEqual(rec.errors.map((e) => e.code), ['discount_exceeds_item']);
  // The maths never goes negative on that item.
  const r = computeTotals(items, { p: ['A'] }, bill, ['A']);
  assert.equal(r.perPerson.A.itemsCents, 0);
});

test('negative rounding -0.02 with 3 payers: whole cents, sums to -0.02, within 1 cent', () => {
  const items = [
    { id: '1', name: '1', line_total: 10 },
    { id: '2', name: '2', line_total: 10 },
    { id: '3', name: '3', line_total: 10 },
  ];
  const bill = { subtotal: 30, discount: 0, service_charge: 0, tax: 0, rounding: -0.02, grand_total: 29.98 };
  const r = computeTotals(items, { 1: ['A'], 2: ['B'], 3: ['C'] }, bill, ['A', 'B', 'C']);
  const rounding = ['A', 'B', 'C'].map((n) => r.perPerson[n].roundingCents);
  assert.deepEqual(rounding, [-1, -1, 0]);
  assert.equal(rounding.reduce((s, v) => s + v, 0), -2);
  assert.equal(sumAll(r), 2998);
});

test('negative amounts are normalised: negative discounts read positive, a negative line becomes bill discount', () => {
  const rec = reconcileReceipt(
    [{ id: 'a', name: 'A', line_total: 40, discount: -8 }],
    { discount: -2, service_charge: 0, tax: 0, rounding: 0, grand_total: 30 }
  );
  assert.equal(rec.computedCents, 3000);
  assert.equal(rec.matches, true);

  const scan = normalizeScanDiscounts({
    items: [
      { name: 'Tea', line_total: 5, discount: 0 },
      { name: 'Voucher', line_total: -3 },
    ],
    discount: -1,
    service_charge: 0,
    tax: 0,
    rounding: -0.02,
    grand_total: 0.98,
  });
  assert.equal(scan.items.length, 1);
  assert.equal(scan.discount, 4);
  assert.equal(scan.rounding, -0.02); // rounding alone keeps its sign
  assert.ok(scan.items.every((i) => i.line_total >= 0 && i.discount >= 0));
});

test('a person with weight 0 (only free items) receives no share of any bill line', () => {
  const items = [
    { id: 'free', name: 'Free', line_total: 8, discount: 8 },
    { id: 'p', name: 'P', line_total: 20 },
  ];
  const bill = { subtotal: 28, discount: 2, service_charge: 1.8, tax: 1.08, rounding: 0.02, grand_total: 20.9 };
  const r = computeTotals(items, { free: ['A'], p: ['B'] }, bill, ['A', 'B']);
  const a = r.perPerson.A;
  assert.deepEqual([a.taxCents, a.serviceCents, a.discountCents, a.roundingCents, a.totalCents], [0, 0, 0, 0, 0]);
  assert.equal(r.perPerson.B.totalCents, 2090);
  assert.equal(reconcileReceipt(items, bill).matches, true);
});

test('an item shared by several people with an item discount splits the net, cents all add up', () => {
  const items = [{ id: 'k', name: 'K', line_total: 10, discount: 0.01 }]; // net 9.99 over 3
  const bill = { subtotal: 10, discount: 0, service_charge: 0, tax: 0, rounding: 0, grand_total: 9.99 };
  const r = computeTotals(items, { k: ['A', 'B', 'C'] }, bill, ['A', 'B', 'C']);
  assert.deepEqual(totalsOf(r, ['A', 'B', 'C']), [333, 333, 333]);
  const items2 = [{ id: 'k', name: 'K', line_total: 10, discount: 0.02 }]; // net 9.98
  const r2 = computeTotals(items2, { k: ['A', 'B', 'C'] }, { ...bill, grand_total: 9.98 }, ['A', 'B', 'C']);
  assert.deepEqual(totalsOf(r2, ['A', 'B', 'C']), [333, 333, 332]);
  assert.equal(sumAll(r2), 998);
});

test('the check is exact: off by one sen fails, with the exact difference', () => {
  const off = { ...billA, grand_total: 104.96 };
  const rec = reconcileReceipt(itemsA, off);
  assert.equal(rec.matches, false);
  assert.equal(rec.differenceCents, 1);
  const other = reconcileReceipt(itemsA, { ...billA, grand_total: 104.94 });
  assert.equal(other.differenceCents, -1);
  assert.equal(other.matches, false);
});

test('double-count trap: net printed and discount subtracted again is off by exactly the discount, with a hint', () => {
  // Receipt: line shows 40.00, "Disc -8.00" under it, total 32.00. Wrong capture: line 32 AND discount 8.
  const wrong = [{ id: 'x', name: 'X', line_total: 32, discount: 8 }];
  const bill = { subtotal: 32, discount: 0, service_charge: 0, tax: 0, rounding: 0, grand_total: 32 };
  const rec = reconcileReceipt(wrong, bill);
  assert.equal(rec.matches, false);
  assert.equal(rec.differenceCents, 800);
  assert.deepEqual(rec.hint, { code: 'discount_mismatch', amountCents: 800, multiple: 1 });
  // Correct capture reconciles with no hint.
  const right = reconcileReceipt([{ id: 'x', name: 'X', line_total: 40, discount: 8 }], bill);
  assert.equal(right.matches, true);
  assert.equal(right.hint, null);
  // Double counted discount (off by twice the amount) is also named.
  const twice = reconcileReceipt(wrong, { ...bill, grand_total: 40 });
  assert.equal(twice.hint.multiple, 2);
});

test('no discount and no rounding: figures identical to the original arithmetic, check not applicable on old data', () => {
  const items = [
    { id: 'i1', name: 'Nasi', line_total: 10.1 },
    { id: 'i2', name: 'Teh', line_total: 9.99 },
    { id: 'i3', name: 'Roti', line_total: 5 },
  ];
  const old = { subtotal: 25.09, service_charge: 2.51, tax: 1.5, grand_total: 29.1 };
  const withZeros = { ...old, discount: 0, rounding: 0 };
  const assign = { i1: ['A', 'B'], i2: ['A', 'B', 'C'], i3: ['C'] };
  const a = computeTotals(items, assign, old, ['A', 'B', 'C']);
  const b = computeTotals(items, assign, withZeros, ['A', 'B', 'C']);
  assert.deepEqual(totalsOf(a, ['A', 'B', 'C']), totalsOf(b, ['A', 'B', 'C']));
  for (const p of Object.values(a.perPerson)) {
    assert.equal(p.discountCents ?? 0, 0);
    assert.equal(p.roundingCents ?? 0, 0);
  }
  assert.equal(hasDiscountFields(items, old), false);
  assert.equal(reconcileReceipt(items, old).applicable, false);
  assert.equal(hasDiscountFields(items, withZeros), true);
  assert.equal(reconcileReceipt(items, withZeros).applicable, true);
  assert.equal(hasDiscountFields([{ id: 'x', line_total: 1, discount: 0 }], old), true);
});

test('each share of each bill line is within 1 cent of exact proportion; persons + unclaimed = grand total (seeded property check)', () => {
  let seed = 20261023;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const randCents = (max) => Math.floor(rand() * max);
  for (let run = 0; run < 600; run += 1) {
    const payerCount = 1 + Math.floor(rand() * 5);
    const payers = Array.from({ length: payerCount }, (_, i) => `P${i}`);
    const itemCount = 1 + Math.floor(rand() * 7);
    const items = [];
    const assignments = {};
    for (let i = 0; i < itemCount; i += 1) {
      const gross = 1 + randCents(9000);
      const disc = rand() < 0.35 ? randCents(gross + 1) : 0; // up to equal to the item
      items.push({ id: `i${i}`, name: `i${i}`, line_total: gross / 100, discount: disc / 100 });
      const chosen = payers.filter(() => rand() < 0.5);
      if (rand() < 0.15) continue; // unassigned
      assignments[`i${i}`] = chosen; // may be empty -> unclaimed
    }
    const bill = {
      subtotal: 0,
      discount: (rand() < 0.5 ? randCents(2000) : 0) / 100,
      service_charge: (rand() < 0.6 ? randCents(1500) : 0) / 100,
      tax: (rand() < 0.6 ? randCents(1200) : 0) / 100,
      rounding: (rand() < 0.5 ? randCents(9) - 4 : 0) / 100,
    };
    const netTotal = items.reduce((s, it) => s + Math.round(it.line_total * 100) - Math.round(it.discount * 100), 0);
    // A whole-bill discount cannot exceed the items total.
    bill.discount = Math.min(Math.round(bill.discount * 100), netTotal) / 100;
    const grandCents =
      netTotal - Math.round(bill.discount * 100) + Math.round(bill.service_charge * 100) + Math.round(bill.tax * 100) + Math.round(bill.rounding * 100);
    bill.grand_total = grandCents / 100;
    assert.equal(reconcileReceipt(items, bill).matches, true, 'generator builds exact receipts');

    const r = computeTotals(items, assignments, bill, payers);
    const slots = [...Object.values(r.perPerson), r.unclaimed];
    const weightTotal = slots.reduce((s, p) => s + p.itemsCents, 0);

    // The new-path invariant needs every net cent to be somewhere (weights). Legacy path (no bill discount/rounding)
    // keeps its original, looser rule, so only the sum is asserted there.
    assert.equal(sumAll(r), grandCents, `run ${run}: persons + unclaimed must equal the grand total`);

    const newPath = bill.discount !== 0 || bill.rounding !== 0 || items.some((it) => it.discount > 0);
    if (newPath && weightTotal > 0) {
      const lines = [
        ['discountCents', Math.round(bill.discount * 100)],
        ['serviceCents', Math.round(bill.service_charge * 100)],
        ['taxCents', Math.round(bill.tax * 100)],
        ['roundingCents', Math.round(bill.rounding * 100)],
      ];
      for (const [field, amount] of lines) {
        assert.equal(slots.reduce((s, p) => s + p[field], 0), amount, `${field} adds up exactly`);
        for (const p of slots) {
          const exact = (amount * p.itemsCents) / weightTotal;
          assert.ok(Math.abs(p[field] - exact) < 1, `${field} within 1 cent (run ${run})`);
          if (p.itemsCents === 0) assert.equal(p[field], 0, 'weight 0 gets nothing');
        }
      }
    }
  }
});

test('manual-mode items work from the net amount; remaining is measured against the net', () => {
  const items = [{ id: 'm', name: 'M', line_total: 20, discount: 5 }];
  const bill = { subtotal: 20, discount: 0, service_charge: 0, tax: 0, rounding: 0, grand_total: 15 };
  const r = computeTotals(items, { m: { mode: 'manual', amounts: { A: 1000, B: 500 } } }, bill, ['A', 'B']);
  assert.deepEqual(totalsOf(r, ['A', 'B']), [1000, 500]);
  const remaining = manualItemRemainingCents(items[0], { mode: 'manual', manual: { values: { A: { cents: 1000 } } } });
  assert.equal(remaining, 500);
});

test('old scan / old split with none of the new fields reads them as 0', () => {
  const items = [{ id: 'a', name: 'A', line_total: 10 }];
  const bill = { subtotal: 10, service_charge: 1, tax: 0.6, grand_total: 11.6 };
  const r = computeTotals(items, { a: ['A'] }, bill, ['A']);
  assert.equal(r.perPerson.A.totalCents, 1160);
  const norm = normalizeScanDiscounts({ items, ...bill });
  assert.equal(norm.discount, 0);
  assert.equal(norm.rounding, 0);
  assert.equal(norm.items[0].discount, 0);
});

// Every item fully discounted, nothing else on the bill but service and tax:
// shares plus unclaimed must still come to the printed grand total.
const freeBill = (over = {}) => ({ subtotal: 10, discount: 0, service_charge: 1, tax: 1.2, rounding: 0, grand_total: 2.2, ...over });
const freeItems = () => [{ id: 'f', name: 'Free', line_total: 10, discount: 10 }];

test('all items fully discounted, assigned: service and tax are kept, not lost', () => {
  const r = computeTotals(freeItems(), { f: ['A'] }, freeBill(), ['A']);
  assert.equal(sumAll(r), 220);
  assert.equal(r.perPerson.A.totalCents, 0);
  assert.equal(r.unclaimed.serviceCents, 100);
  assert.equal(r.unclaimed.taxCents, 120);
});

test('all items fully discounted, unassigned: same total', () => {
  const r = computeTotals(freeItems(), {}, freeBill(), ['A']);
  assert.equal(sumAll(r), 220);
});

test('all items fully discounted, several items and several payers', () => {
  const items = [
    { id: 'f1', name: 'F1', line_total: 10, discount: 10 },
    { id: 'f2', name: 'F2', line_total: 6.5, discount: 6.5 },
  ];
  const bill = freeBill({ subtotal: 16.5, service_charge: 1.65, tax: 0.99, grand_total: 2.64 });
  const r = computeTotals(items, { f1: ['A', 'B'], f2: ['C'] }, bill, ['A', 'B', 'C']);
  assert.equal(sumAll(r), 264);
  assert.equal(reconcileReceipt(items, bill).matches, true);
});

test('all items fully discounted with only service, or only tax', () => {
  assert.equal(sumAll(computeTotals(freeItems(), { f: ['A'] }, freeBill({ tax: 0, grand_total: 1 }), ['A'])), 100);
  assert.equal(sumAll(computeTotals(freeItems(), { f: ['A'] }, freeBill({ service_charge: 0, grand_total: 1.2 }), ['A'])), 120);
});

test('all items fully discounted with no service and no tax: nothing to share, total 0', () => {
  const r = computeTotals(freeItems(), { f: ['A'] }, freeBill({ service_charge: 0, tax: 0, grand_total: 0 }), ['A']);
  assert.equal(sumAll(r), 0);
  assert.equal(r.unclaimed.totalCents, 0);
});

test('a bill with a paid item next to a free one: the free item has no weight, the paid one carries service and tax', () => {
  const items = [
    { id: 'f', name: 'Free', line_total: 10, discount: 10 },
    { id: 'p', name: 'P', line_total: 10, discount: 0 },
  ];
  const bill = freeBill({ subtotal: 20, grand_total: 12.2 });
  const r = computeTotals(items, { f: ['A'], p: ['B'] }, bill, ['A', 'B']);
  assert.equal(r.perPerson.B.totalCents, 1220);
  assert.equal(r.perPerson.A.totalCents, 0);
  assert.equal(sumAll(r), 1220);
});

test('item discount only, shared by three: service and tax shares are each within 1 cent of exact', () => {
  const items = [{ id: 'x', name: 'X', line_total: 82.63, discount: 76.25 }];
  const bill = { subtotal: 82.63, discount: 0, service_charge: 16.37, tax: 5.74, rounding: 0, grand_total: 28.49 };
  assert.equal(reconcileReceipt(items, bill).matches, true);
  const r = computeTotals(items, { x: ['B', 'C', 'E'] }, bill, ['B', 'C', 'E']);
  // Each person's net item share is 2.13 / 2.13 / 2.12 (6.38 shared three ways).
  for (const n of ['B', 'C', 'E']) {
    const p = r.perPerson[n];
    assert.ok(Math.abs(p.serviceCents - (1637 * p.itemsCents) / 638) < 1);
    assert.ok(Math.abs(p.taxCents - (574 * p.itemsCents) / 638) < 1);
  }
  assert.equal(sumAll(r), 2849);
});

test('item discount only, no bill discount or rounding: sum is exact and unclaimed carries its share', () => {
  const items = [
    { id: 'x', name: 'X', line_total: 40, discount: 8 },
    { id: 'y', name: 'Y', line_total: 60, discount: 0 },
  ];
  const bill = { subtotal: 100, discount: 0, service_charge: 9.2, tax: 0, rounding: 0, grand_total: 101.2 };
  const r = computeTotals(items, { x: ['A'] }, bill, ['A', 'B']);
  assert.equal(sumAll(r), 10120);
  assert.equal(r.unclaimed.itemsCents, 6000);
});

test('no item discount, no bill discount, no rounding: original arithmetic, no new keys', () => {
  const items = [{ id: 'a', name: 'A', line_total: 10, discount: 0 }, { id: 'b', name: 'B', line_total: 20 }];
  const bill = { subtotal: 30, discount: 0, service_charge: 3, tax: 1.8, rounding: 0, grand_total: 34.8 };
  const r = computeTotals(items, { a: ['A'], b: ['B'] }, bill, ['A', 'B']);
  assert.equal('discountCents' in r.unclaimed, false);
  assert.equal('discountCents' in r.perPerson.A, false);
  assert.equal(sumAll(r), 3480);
});

test('a whole-bill discount larger than the items total is refused by reconcileReceipt itself', () => {
  const items = [
    { id: 'a', name: 'A', line_total: 30 },
    { id: 'b', name: 'B', line_total: 70 },
  ];
  const bill = { subtotal: 100, discount: 101, service_charge: 8, tax: 4, rounding: 0, grand_total: 11 };
  const rec = reconcileReceipt(items, bill);
  assert.equal(rec.matches, false);
  assert.deepEqual(rec.errors.map((e) => e.code), ['bill_discount_exceeds_items']);
});

test('a whole-bill discount equal to the items total is still allowed', () => {
  const items = [
    { id: 'a', name: 'A', line_total: 30 },
    { id: 'b', name: 'B', line_total: 70 },
  ];
  const bill = { subtotal: 100, discount: 100, service_charge: 8, tax: 4, rounding: 0, grand_total: 12 };
  const rec = reconcileReceipt(items, bill);
  assert.equal(rec.matches, true);
  assert.deepEqual(rec.errors, []);
});

test('a bill discount above the items net (after item discounts) is refused; an item error is reported first', () => {
  const items = [{ id: 'a', name: 'A', line_total: 50, discount: 20 }];
  const over = reconcileReceipt(items, { subtotal: 50, discount: 31, service_charge: 0, tax: 0, rounding: 0, grand_total: -1 });
  assert.deepEqual(over.errors.map((e) => e.code), ['bill_discount_exceeds_items']);
  const both = reconcileReceipt([{ id: 'a', name: 'A', line_total: 10, discount: 12 }], { subtotal: 10, discount: 5, service_charge: 0, tax: 0, rounding: 0, grand_total: 0 });
  assert.equal(both.errors[0].code, 'discount_exceeds_item');
});
