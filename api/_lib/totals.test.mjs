// api/_lib/totals.test.mjs
//
// Proves the two entry points to the money arithmetic (the CommonJS module the
// serverless handlers require, and the ESM re-export the browser bundle
// imports) are the same code and return byte-identical results.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from '../../js/totals.js';

const require = createRequire(import.meta.url);
const cjs = require('./totals.js');

const items = [
  { id: 'i1', name: 'Nasi Lemak', qty: 1, unit_price: 10.1, line_total: 10.1 },
  { id: 'i2', name: 'Teh Tarik', qty: 3, unit_price: 3.33, line_total: 9.99 },
  { id: 'i3', name: 'Roti', qty: 1, unit_price: 5, line_total: 5 },
  { id: 'i4', name: 'Satay', qty: 1, unit_price: 12, line_total: 12 },
];
const bill = { subtotal: 37.09, service_charge: 3.71, tax: 2.4, grand_total: 43.2 };
const payers = ['Ali', 'Bea', 'Chan'];

const equalAssignments = {
  i1: ['Ali', 'Bea'],
  i2: { mode: 'equal', equal: ['Ali', 'Bea', 'Chan'] },
  i3: ['Chan'],
  i4: ['Ali', 'Chan'],
};
const manualAssignments = {
  ...equalAssignments,
  i4: { mode: 'manual', amounts: { Ali: 700, Bea: 300, Chan: 200 } },
};

test('both entry points expose the same function set', () => {
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  for (const name of Object.keys(cjs)) {
    assert.equal(esm[name], cjs[name], `${name} must be the same function`);
  }
});

test('equal-split mode: byte-identical results from both entry points', () => {
  const a = JSON.stringify(cjs.computeTotals(items, equalAssignments, bill, payers));
  const b = JSON.stringify(esm.computeTotals(items, equalAssignments, bill, payers));
  assert.equal(a, b);
});

test('manual mode: byte-identical results from both entry points', () => {
  const a = JSON.stringify(cjs.computeTotals(items, manualAssignments, bill, payers));
  const b = JSON.stringify(esm.computeTotals(items, manualAssignments, bill, payers));
  assert.equal(a, b);
});

test('helper functions agree across entry points', () => {
  for (const v of [0, 1.005, 12.34, -3.1, '4.5', null]) {
    assert.equal(cjs.toCents(v), esm.toCents(v));
    assert.equal(cjs.formatRM(v), esm.formatRM(v));
    assert.equal(cjs.formatRMLocked(v), esm.formatRMLocked(v));
  }
  assert.equal(cjs.percentToCents(33.3, 10.1), esm.percentToCents(33.3, 10.1));
  assert.equal(cjs.centsToPercent(337, 10.1), esm.centsToPercent(337, 10.1));
});

test('per-person totals still sum to the itemised total plus tax and service', () => {
  const { perPerson, itemizedSubtotalCents } = cjs.computeTotals(items, equalAssignments, bill, payers);
  const sum = Object.values(perPerson).reduce((s, p) => s + p.totalCents, 0);
  assert.equal(sum, itemizedSubtotalCents + cjs.toCents(bill.tax) + cjs.toCents(bill.service_charge));
});

test('CommonJS require works the way a serverless handler loads it', () => {
  const again = createRequire(new URL('../split.js', import.meta.url))('./_lib/totals');
  assert.equal(again, cjs);
  assert.equal(typeof again.computeTotals, 'function');
});

// ---- name-key safety: a name matching an Object.prototype key is data, never a payer ----

const probeItems = [{ id: 'i1', name: 'Nasi', qty: 1, unit_price: 10, line_total: 10 }];
const probeBill = { subtotal: 10, service_charge: 1, tax: 0.6, grand_total: 11.6 };

function globalsSnapshot() {
  return JSON.stringify([
    Object.keys(Object),
    Object.keys(Object.prototype),
    Object.getOwnPropertyNames(Object.prototype).sort(),
    Object.itemsCents,
    Object.totalCents,
  ]);
}

test('equal split: off-roster names that match Object.prototype keys are NOT payers and touch no globals', () => {
  const before = globalsSnapshot();
  for (const reserved of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__', 'prototype']) {
    const roster = ['Ali'];
    const withReserved = cjs.computeTotals(probeItems, { i1: [reserved] }, probeBill, roster);
    const unassigned = cjs.computeTotals(probeItems, {}, probeBill, roster);
    assert.equal(JSON.stringify(withReserved), JSON.stringify(unassigned), reserved);
    assert.deepEqual(Object.keys(withReserved.perPerson), ['Ali'], reserved);
    for (const p of Object.values(withReserved.perPerson)) assert.equal(Number.isNaN(p.totalCents), false);
    // wrapper shape too
    const wrapped = cjs.computeTotals(probeItems, { i1: { mode: 'equal', equal: [reserved] } }, probeBill, roster);
    assert.equal(JSON.stringify(wrapped), JSON.stringify(unassigned), `${reserved} (wrapper)`);
  }
  assert.equal(globalsSnapshot(), before);
  assert.equal(Object.itemsCents, undefined);
  assert.equal(({}).itemsCents, undefined);
});

test('equal split: a real payer sharing a dish with an off-roster reserved name is charged as if alone', () => {
  const roster = ['Ali', 'Bea'];
  const mixed = cjs.computeTotals(probeItems, { i1: ['constructor', 'Ali'] }, probeBill, roster);
  const alone = cjs.computeTotals(probeItems, { i1: ['Ali'] }, probeBill, roster);
  assert.equal(JSON.stringify(mixed), JSON.stringify(alone));
});

test('manual split: reserved keys in amounts are ignored, not charged and not written to globals', () => {
  const before = globalsSnapshot();
  const roster = ['Ali'];
  const amounts = JSON.parse('{"__proto__": 500, "constructor": 500, "toString": 500, "Ali": 400}');
  const withReserved = cjs.computeTotals(probeItems, { i1: { mode: 'manual', amounts } }, probeBill, roster);
  const plain = cjs.computeTotals(probeItems, { i1: { mode: 'manual', amounts: { Ali: 400 } } }, probeBill, roster);
  assert.equal(JSON.stringify(withReserved), JSON.stringify(plain));
  const stored = JSON.parse('{"__proto__": {"cents": 500}, "constructor": {"cents": 500}, "Ali": {"cents": 400}}');
  const viaStored = cjs.computeTotals(
    probeItems,
    { i1: { mode: 'manual', manual: { values: stored } } },
    probeBill,
    roster
  );
  assert.equal(JSON.stringify(viaStored), JSON.stringify(plain));
  assert.equal(globalsSnapshot(), before);
});

test('an item id that matches an Object.prototype key is treated as an ordinary unassigned item', () => {
  const items = [{ id: 'constructor', name: 'Odd', qty: 1, unit_price: 10, line_total: 10 }];
  const result = cjs.computeTotals(items, {}, probeBill, ['Ali']);
  assert.equal(result.unclaimed.itemsCents, 1000);
  assert.equal(result.perPerson.Ali.totalCents, 0);
});

test('js/totals.js entry point behaves the same on the reserved-name probe', () => {
  const a = JSON.stringify(cjs.computeTotals(probeItems, { i1: ['constructor'] }, probeBill, ['Ali']));
  const b = JSON.stringify(esm.computeTotals(probeItems, { i1: ['constructor'] }, probeBill, ['Ali']));
  assert.equal(a, b);
});
