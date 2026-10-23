// src/screens/receipt-status.test.mjs — the wording decisions behind the status
// panel: which state, the exact difference, and the hint.
//
// Run: node --test src/screens/receipt-status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as receiptStatusModule from './receipt-status.js';
import { computeReceiptStatus } from './receipt-status.js';

const food = (id, line_total, discount = 0) => ({ id, name: `Dish ${id}`, category: 'food', qty: 1, unit_price: line_total, line_total, discount });
const bill = (extra = {}) => ({ subtotal: 100, service_charge: 9, tax: 5.94, discount: 0, rounding: 0, grand_total: 114.94, ...extra });
const items = () => [food('a', 50), food('b', 30), food('c', 20)];

test('exact: ok, not blocked, difference 0', () => {
  const s = computeReceiptStatus(items(), bill());
  assert.equal(s.kind, 'ok');
  assert.equal(s.blocked, false);
  assert.equal(s.differenceCents, 0);
});

test('an older shape (no discount or rounding fields) is not checked', () => {
  const old = [{ id: 'a', name: 'Teh', category: 'drink', qty: 1, unit_price: 5, line_total: 5 }];
  const s = computeReceiptStatus(old, { subtotal: 5, service_charge: 0, tax: 0, grand_total: 99 });
  assert.equal(s.kind, 'none');
  assert.equal(s.blocked, false);
});

test('no items: no status', () => {
  assert.equal(computeReceiptStatus([], bill()).kind, 'none');
});

test('one sen out either way: blocked with the signed direction and exact figures', () => {
  const short = computeReceiptStatus(items(), bill({ grand_total: 114.95 }));
  assert.equal(short.kind, 'off');
  assert.equal(short.direction, 'short');
  assert.equal(short.differenceCents, 1);
  assert.equal(short.computedCents, 11494);
  assert.equal(short.grandTotalCents, 11495);
  const over = computeReceiptStatus(items(), bill({ grand_total: 114.93 }));
  assert.equal(over.direction, 'over');
  assert.equal(over.differenceCents, -1);
  assert.equal(over.blocked, true);
});

test('an item discount above its price: blocked, names the item, no rounding offer', () => {
  const s = computeReceiptStatus([food('a', 40, 41), food('b', 60)], bill({ grand_total: 109.2 }));
  assert.equal(s.kind, 'item_discount_too_big');
  assert.equal(s.itemName, 'Dish a');
  assert.equal(s.blocked, true);
  assert.equal('rounding' in s, false);
});

test('an item discount equal to its price is allowed', () => {
  const s = computeReceiptStatus([food('a', 40, 40), food('b', 60)], bill({ service_charge: 0, tax: 0, grand_total: 60 }));
  assert.equal(s.kind, 'ok');
});

test('a bill discount above the items total: its own state; equal is allowed', () => {
  const tooBig = computeReceiptStatus(items(), bill({ discount: 100.01 }));
  assert.equal(tooBig.kind, 'bill_discount_too_big');
  assert.equal(tooBig.blocked, true);
  assert.equal('rounding' in tooBig, false);
  const equal = computeReceiptStatus(items(), bill({ discount: 100, grand_total: 14.94 }));
  assert.equal(equal.kind, 'ok');
});

test('an item with a negative price is blocked', () => {
  const s = computeReceiptStatus([food('a', -5), food('b', 60)], bill());
  assert.equal(s.kind, 'item_price_invalid');
  assert.equal(s.blocked, true);
});

test('hint: a difference equal to one item discount points at that item, with the direction', () => {
  const list = [food('a', 40, 8), food('b', 60)];
  const short = computeReceiptStatus(list, bill({ service_charge: 9.2, tax: 0, grand_total: 109.2 }));
  assert.equal(short.hint.target, 'item');
  assert.equal(short.hint.amountCents, 800);
  assert.equal(short.hint.direction, 'short');
  const over = computeReceiptStatus(list, bill({ service_charge: 9.2, tax: 0, grand_total: 93.2 }));
  assert.equal(over.hint.direction, 'over');
});

test('hint: twice a discount counts, a bill discount match points at the bill, several items say items', () => {
  const list = [food('a', 40, 8), food('b', 60)];
  const double = computeReceiptStatus(list, bill({ service_charge: 9.2, tax: 0, grand_total: 117.2 }));
  assert.equal(double.hint.amountCents, 800);
  const billMatch = computeReceiptStatus(items(), bill({ discount: 10, grand_total: 104.94 + 10 }));
  assert.equal(billMatch.hint.target, 'bill');
  const several = computeReceiptStatus(
    [food('a', 40, 8), food('b', 60, 8)],
    bill({ service_charge: 9.2, tax: 0, grand_total: 93.2 + 8 })
  );
  assert.equal(several.hint.target, 'items');
});

test('no hint when the difference matches no discount', () => {
  assert.equal(computeReceiptStatus(items(), bill({ grand_total: 114.95 })).hint, null);
});

test('the app never offers to turn a difference into rounding: no switch, no rounding verdict', () => {
  assert.equal('ALLOW_USE_DIFFERENCE_AS_ROUNDING' in receiptStatusModule, false);
  assert.equal('MAX_ROUNDING_CENTS' in receiptStatusModule, false);
  const s = computeReceiptStatus(items(), bill({ grand_total: 114.99 }));
  assert.equal(s.kind, 'off');
  assert.equal(s.blocked, true);
  assert.equal('rounding' in s, false);
});
