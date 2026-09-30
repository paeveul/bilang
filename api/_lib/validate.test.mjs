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
import {
  validateSplitCreateRequest,
  validateParsedReceipt,
  validateClaimRequest,
  resolveRosterName,
  validateOtpRequest,
  validateOtpVerify,
} from './validate.js';

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

test('payers: names are trimmed, 1-20 characters', () => {
  const ok = (payers) => validateSplitCreateRequest(validSplitBody({ payers }));
  assert.equal(ok(['a']), null);
  assert.equal(ok(['x'.repeat(20)]), null);
  assert.equal(ok(['  Bea  ']), null);
  assert.equal(ok(['  ' + 'x'.repeat(20) + '  ']), null);
  assert.equal(ok(['x'.repeat(21)]), 'Invalid payers list');
  assert.equal(ok(['   ']), 'Invalid payers list');
  assert.equal(ok(['Alex', '  ']), 'Invalid payers list');
});

test('payers: unique case-insensitively, after trimming', () => {
  const bad = (payers) => validateSplitCreateRequest(validSplitBody({ payers }));
  assert.equal(bad(['Alex', 'alex']), 'Invalid payers list');
  assert.equal(bad(['Alex', ' ALEX ']), 'Invalid payers list');
  assert.equal(bad(['Alex', 'Alexa']), null);
});

test('payers: hidden ceiling of 200 people, plain rejection above it', () => {
  const roster = (n) => Array.from({ length: n }, (_, i) => `P${i}`);
  assert.equal(validateSplitCreateRequest(validSplitBody({ payers: roster(200) })), null);
  assert.equal(validateSplitCreateRequest(validSplitBody({ payers: roster(201) })), 'Invalid payers list');
});

// --- validateSplitCreateRequest: merchantName / receiptDate (Item 23, D4/D6) ---

test('merchantName/receiptDate are optional; omitting both still passes', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody()), null);
});

test('merchantName/receiptDate: explicit null (read but illegible) is accepted', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody({ merchantName: null, receiptDate: null })), null);
});

test('merchantName/receiptDate: valid values are accepted', () => {
  assert.equal(
    validateSplitCreateRequest(validSplitBody({ merchantName: 'Restoran Uncle', receiptDate: '2026-09-28' })),
    null
  );
});

test('merchantName: rejects a non-string', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody({ merchantName: 123 })), 'Invalid merchant name');
});

test('merchantName: rejects a string over 200 chars', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody({ merchantName: 'x'.repeat(201) })), 'Invalid merchant name');
});

test('receiptDate: rejects a non-ISO-formatted string', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody({ receiptDate: '28/09/2026' })), 'Invalid receipt date');
  assert.equal(validateSplitCreateRequest(validSplitBody({ receiptDate: '2026-9-28' })), 'Invalid receipt date');
});

test('receiptDate: rejects a non-string', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody({ receiptDate: 20260928 })), 'Invalid receipt date');
});

// --- validateClaimRequest (PATCH /api/split, Item 24 Step 3) ---

const claimSplit = { items: [{ id: 'i1' }, { id: 'i2' }], payers: ['Ali', 'Bea', ' Cy '] };
const claimBody = (overrides = {}) => ({ action: 'claim', itemId: 'i1', payer: 'Ali', ...overrides });

test('validateClaimRequest: valid claim, unclaim and shared claim pass', () => {
  assert.equal(validateClaimRequest(claimBody(), claimSplit), null);
  assert.equal(validateClaimRequest(claimBody({ action: 'unclaim' }), claimSplit), null);
  assert.equal(validateClaimRequest(claimBody({ sharedWith: ['Bea', 'Cy'] }), claimSplit), null);
  assert.equal(validateClaimRequest(claimBody({ sharedWith: [] }), claimSplit), null);
});

test('validateClaimRequest: shape-only mode (no split yet) skips roster and item checks', () => {
  assert.equal(validateClaimRequest(claimBody({ itemId: 'nope', payer: 'Zed' })), null);
  assert.notEqual(validateClaimRequest({ action: 'claim' }), null);
});

test('validateClaimRequest: rejects a missing, non-object or array body', () => {
  for (const bad of [undefined, null, 'x', 5, []]) {
    assert.notEqual(validateClaimRequest(bad, claimSplit), null);
  }
});

test('validateClaimRequest: rejects unknown fields, including items, totals and assignments', () => {
  for (const field of ['items', 'totals', 'assignments', 'version', 'extra']) {
    assert.match(validateClaimRequest(claimBody({ [field]: {} }), claimSplit), /Unknown field/);
  }
});

test('validateClaimRequest: the unknown-field message is fixed and never echoes the caller field name', () => {
  const messages = new Set();
  for (const field of ['items', 'zz_secret_field_9', '<script>alert(1)</script>', 'a'.repeat(300)]) {
    const message = validateClaimRequest(claimBody({ [field]: 1 }), claimSplit);
    assert.equal(typeof message, 'string');
    assert.equal(message.includes(field), false, field.slice(0, 20));
    messages.add(message);
  }
  assert.equal(messages.size, 1);
});

test('validateClaimRequest: rejects a bad action', () => {
  for (const action of [undefined, 'delete', 'CLAIM', 1]) {
    assert.equal(validateClaimRequest(claimBody({ action }), claimSplit), 'Invalid action');
  }
});

test('validateClaimRequest: rejects a bad or unknown itemId', () => {
  for (const itemId of [undefined, '', 5, 'x'.repeat(201)]) {
    assert.equal(validateClaimRequest(claimBody({ itemId }), claimSplit), 'Invalid itemId');
  }
  assert.equal(validateClaimRequest(claimBody({ itemId: 'zzz' }), claimSplit), 'Unknown itemId');
});

test('validateClaimRequest: payer name is trimmed 1-20 characters and must be on the roster', () => {
  for (const payer of [undefined, '', '   ', 7, 'x'.repeat(21)]) {
    assert.equal(validateClaimRequest(claimBody({ payer }), claimSplit), 'Invalid payer name');
  }
  assert.equal(validateClaimRequest(claimBody({ payer: 'Zed' }), claimSplit), 'Name is not on this split');
  assert.equal(validateClaimRequest(claimBody({ payer: '  ali ' }), claimSplit), null);
  assert.equal(
    validateClaimRequest(claimBody({ payer: 'x'.repeat(20) }), { ...claimSplit, payers: ['x'.repeat(20)] }),
    null
  );
});

test('validateClaimRequest: sharedWith rules', () => {
  assert.equal(validateClaimRequest(claimBody({ sharedWith: 'Bea' }), claimSplit), 'Invalid sharedWith list');
  assert.equal(validateClaimRequest(claimBody({ sharedWith: [1] }), claimSplit), 'Invalid name in sharedWith');
  assert.equal(validateClaimRequest(claimBody({ sharedWith: ['Zed'] }), claimSplit), 'Name is not on this split');
  assert.equal(validateClaimRequest(claimBody({ sharedWith: ['Ali'] }), claimSplit), 'Duplicate names in claim');
  assert.equal(validateClaimRequest(claimBody({ sharedWith: ['bea', 'BEA'] }), claimSplit), 'Duplicate names in claim');
  assert.equal(
    validateClaimRequest(claimBody({ action: 'unclaim', sharedWith: ['Bea'] }), claimSplit),
    'sharedWith applies to claim only'
  );
});

test('validateClaimRequest: hidden ceiling of 200 people and body size cap', () => {
  const many = Array.from({ length: 200 }, (_, i) => `P${i}`);
  const big = { items: [{ id: 'i1' }], payers: many };
  assert.equal(validateClaimRequest(claimBody({ payer: 'P0', sharedWith: many.slice(1) }), big), null);
  assert.equal(
    validateClaimRequest(claimBody({ payer: 'P0', sharedWith: [...many.slice(1), 'P200'] }), big),
    'Invalid sharedWith list'
  );
  assert.equal(
    validateClaimRequest(claimBody({ sharedWith: ['Bea'], itemId: 'i'.repeat(20000) }), claimSplit),
    'Request body is too large'
  );
});

test('resolveRosterName: returns the roster spelling, ignoring case and spaces', () => {
  assert.equal(resolveRosterName(claimSplit.payers, 'cy'), ' Cy ');
  assert.equal(resolveRosterName(claimSplit.payers, ' BEA'), 'Bea');
  assert.equal(resolveRosterName(claimSplit.payers, 'Zed'), null);
  assert.equal(resolveRosterName(null, 'Ali'), null);
});

test('payers: names that collide with Object.prototype keys are rejected (case-insensitive, after trim)', () => {
  const ok = (payers) => validateSplitCreateRequest(validSplitBody({ payers }));
  for (const bad of ['__proto__', 'constructor', 'prototype', '__PROTO__', ' Constructor ', 'PROTOTYPE ']) {
    assert.equal(ok([bad, 'Bea']), 'Invalid payers list', JSON.stringify(bad));
    assert.equal(ok(['Bea', bad]), 'Invalid payers list', JSON.stringify(bad));
  }
  // Ordinary names that merely contain those words are fine.
  assert.equal(ok(['Constructor Cy', 'proto']), null);
  assert.equal(ok(['__proto__x']), null);
});

// ---- Item 10 Checkpoint 2, Step 7: validateOtpRequest / validateOtpVerify -

test('validateOtpRequest: accepts a well-formed email', () => {
  assert.equal(validateOtpRequest({ email: 'someone@example.com' }), null);
});

test('validateOtpRequest: rejects a missing or malformed email', () => {
  assert.ok(validateOtpRequest({}));
  assert.ok(validateOtpRequest({ email: 'not-an-email' }));
  assert.ok(validateOtpRequest({ email: '' }));
  assert.ok(validateOtpRequest({ email: 123 }));
  assert.ok(validateOtpRequest(null));
  assert.ok(validateOtpRequest([]));
});

test('validateOtpRequest: rejects an email over the 254-char cap', () => {
  const longLocal = 'a'.repeat(250);
  assert.ok(validateOtpRequest({ email: `${longLocal}@example.com` }));
});

test('validateOtpVerify: accepts a well-formed body with no terms fields', () => {
  assert.equal(validateOtpVerify({ email: 'someone@example.com', code: '123456' }), null);
});

test('validateOtpVerify: accepts a well-formed body with valid terms fields', () => {
  assert.equal(
    validateOtpVerify({ email: 'someone@example.com', code: '123456', termsAccepted: true, termsVersion: '2026-09-23' }),
    null
  );
});

test('validateOtpVerify: rejects a code that is not exactly six digits', () => {
  assert.ok(validateOtpVerify({ email: 'someone@example.com', code: '12345' }));
  assert.ok(validateOtpVerify({ email: 'someone@example.com', code: '1234567' }));
  assert.ok(validateOtpVerify({ email: 'someone@example.com', code: 'abcdef' }));
  assert.ok(validateOtpVerify({ email: 'someone@example.com', code: 123456 }));
  assert.ok(validateOtpVerify({ email: 'someone@example.com' }));
});

test('validateOtpVerify: a malformed email and a malformed code both return the identical fixed message', () => {
  const badEmail = validateOtpVerify({ email: 'nope', code: '123456' });
  const badCode = validateOtpVerify({ email: 'someone@example.com', code: 'xx' });
  assert.equal(badEmail, 'Enter the 6-digit code from your email.');
  assert.equal(badCode, 'Enter the 6-digit code from your email.');
  assert.equal(badEmail, badCode);
});

test('validateOtpVerify: rejects a non-boolean termsAccepted', () => {
  assert.ok(validateOtpVerify({ email: 'someone@example.com', code: '123456', termsAccepted: 'true' }));
});

test('validateOtpVerify: rejects an empty or non-string termsVersion', () => {
  assert.ok(validateOtpVerify({ email: 'someone@example.com', code: '123456', termsVersion: '' }));
  assert.ok(validateOtpVerify({ email: 'someone@example.com', code: '123456', termsVersion: 42 }));
});

test('validateOtpVerify: termsAccepted=false is a valid SHAPE (presence/requiredness is enforced downstream in the endpoint, not here)', () => {
  assert.equal(
    validateOtpVerify({ email: 'someone@example.com', code: '123456', termsAccepted: false, termsVersion: '2026-09-23' }),
    null
  );
});
