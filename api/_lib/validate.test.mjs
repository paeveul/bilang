// api/_lib/validate.test.mjs
//
// Tests for the server-side validation gap closed 2026-09-15 (assessment
// §4.3 / §13.4.2 SM7): validateSplitCreateRequest() gaining qty/unit_price/
// category checks, and the new validateParsedReceipt() shape-validator for
// Claude's tool-call output in api/parse.js.
//
// Run: node --test api/_lib/validate.test.mjs
// (added to package.json's "test" script in this pass — see that diff.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSplitCreateRequest, validateParsedReceipt } from './validate.js';

function validSplitBody(overrides = {}) {
  return {
    items: [{ name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 12.5, line_total: 12.5 }],
    assignments: { i1: ['Alex'] },
    totals: { subtotal: 12.5, service_charge: 0, tax: 0, grand_total: 12.5 },
    ownerPaymentHandle: '012-3456789',
    ...overrides,
  };
}

function validParsedReceipt(overrides = {}) {
  return {
    items: [
      { name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 12.5, line_total: 12.5 },
    ],
    subtotal: 12.5,
    service_charge: 0,
    tax: 0,
    grand_total: 12.5,
    ...overrides,
  };
}

// --- validateSplitCreateRequest: the previously-working case must still pass ---

test('validateSplitCreateRequest: valid request still passes (no regression)', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody()), null);
});

// --- validateSplitCreateRequest: newly-added qty/unit_price/category checks ---

test('validateSplitCreateRequest: rejects missing qty', () => {
  const body = validSplitBody();
  delete body.items[0].qty;
  assert.match(validateSplitCreateRequest(body), /quantity/i);
});

test('validateSplitCreateRequest: rejects zero/negative qty', () => {
  const body = validSplitBody();
  body.items[0].qty = 0;
  assert.match(validateSplitCreateRequest(body), /quantity/i);
  body.items[0].qty = -3;
  assert.match(validateSplitCreateRequest(body), /quantity/i);
});

test('validateSplitCreateRequest: rejects a string qty (the injection payload from §4.3)', () => {
  const body = validSplitBody();
  body.items[0].qty = '<img src=x onerror=alert(1)>';
  assert.match(validateSplitCreateRequest(body), /quantity/i);
});

test('validateSplitCreateRequest: rejects negative unit_price', () => {
  const body = validSplitBody();
  body.items[0].unit_price = -1;
  assert.match(validateSplitCreateRequest(body), /unit price/i);
});

test('validateSplitCreateRequest: accepts zero unit_price (free/promo item)', () => {
  const body = validSplitBody();
  body.items[0].unit_price = 0;
  assert.equal(validateSplitCreateRequest(body), null);
});

test('validateSplitCreateRequest: rejects a category outside the fixed enum', () => {
  const body = validSplitBody();
  body.items[0].category = 'not-a-real-category';
  assert.match(validateSplitCreateRequest(body), /category/i);
});

test('validateSplitCreateRequest: rejects missing category', () => {
  const body = validSplitBody();
  delete body.items[0].category;
  assert.match(validateSplitCreateRequest(body), /category/i);
});

// --- validateParsedReceipt: new shape-validator for Claude's tool-call output ---

test('validateParsedReceipt: well-formed model output passes', () => {
  assert.equal(validateParsedReceipt(validParsedReceipt()), null);
});

test('validateParsedReceipt: rejects null/non-object', () => {
  assert.match(validateParsedReceipt(null), /malformed/i);
  assert.match(validateParsedReceipt('not an object'), /malformed/i);
  assert.match(validateParsedReceipt([1, 2, 3]), /malformed/i);
});

test('validateParsedReceipt: rejects missing items array', () => {
  const parsed = validParsedReceipt();
  delete parsed.items;
  assert.match(validateParsedReceipt(parsed), /malformed/i);
});

test('validateParsedReceipt: rejects an item with a non-numeric qty', () => {
  const parsed = validParsedReceipt();
  parsed.items[0].qty = 'two';
  assert.match(validateParsedReceipt(parsed), /quantity/i);
});

test('validateParsedReceipt: rejects an item with an out-of-enum category', () => {
  const parsed = validParsedReceipt();
  parsed.items[0].category = 'made-up-category';
  assert.match(validateParsedReceipt(parsed), /category/i);
});

test('validateParsedReceipt: rejects a missing top-level total', () => {
  const parsed = validParsedReceipt();
  delete parsed.grand_total;
  assert.match(validateParsedReceipt(parsed), /totals/i);
});

test('validateParsedReceipt: rejects a non-finite top-level total (NaN/Infinity)', () => {
  const parsed = validParsedReceipt({ grand_total: Infinity });
  assert.match(validateParsedReceipt(parsed), /totals/i);
});

test('validateSplitCreateRequest: payers is optional', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody()), null);
});

test('validateSplitCreateRequest: accepts a valid payers list', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody({ payers: ['Alex', 'Bea'] })), null);
});

test('validateSplitCreateRequest: rejects invalid payers', () => {
  for (const payers of ['Alex', [], ['Alex', ''], ['Alex', 'Alex'], ['Alex', 1], [null], {}, null]) {
    assert.equal(
      validateSplitCreateRequest(validSplitBody({ payers })),
      'Invalid payers list',
      JSON.stringify(payers)
    );
  }
});
