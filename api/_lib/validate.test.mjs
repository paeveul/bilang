// api/_lib/validate.test.mjs
//
//
// Run: node --test api/_lib/validate.test.mjs
// (added to package.json's "test" script in this pass — see that diff.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSplitCreateRequest,
  receiptExactnessError,
  stampReceiptGap,
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
  for (const payers of ['Alex', [], ['Alex', ''], ['Alex', 1], [null], {}, null]) {
    assert.equal(
      validateSplitCreateRequest(validSplitBody({ payers })),
      'Invalid payers list',
      JSON.stringify(payers)
    );
  }
});

test('payers: an exact duplicate says so in plain words', () => {
  assert.equal(
    validateSplitCreateRequest(validSplitBody({ payers: ['Alex', 'Alex'] })),
    'Two people have the same name.'
  );
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
  assert.equal(bad(['Alex', 'alex']), 'Two people have the same name.');
  assert.equal(bad(['Alex', ' ALEX ']), 'Two people have the same name.');
  assert.equal(bad(['Alex', 'Alexa']), null);
});

test('payers: hidden ceiling of 200 people, plain rejection above it', () => {
  const roster = (n) => Array.from({ length: n }, (_, i) => `P${i}`);
  assert.equal(validateSplitCreateRequest(validSplitBody({ payers: roster(200) })), null);
  assert.equal(validateSplitCreateRequest(validSplitBody({ payers: roster(201) })), 'Invalid payers list');
});

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

test('payers: look-alike duplicates are rejected with the plain message (inner spaces, full-width, accents, tabs)', () => {
  const bad = (payers) => validateSplitCreateRequest(validSplitBody({ payers }));
  const SAME = 'Two people have the same name.';
  assert.equal(bad(['Ben  Tan', 'Ben Tan']), SAME);
  assert.equal(bad(['Ben Tan', ' ben   TAN ']), SAME);
  assert.equal(bad(['Ben', 'Ｂｅｎ']), SAME); // full-width B e n
  assert.equal(bad(['Bén', 'Bén']), SAME); // accent typed two ways
  assert.equal(bad(['Ben', 'Ben ']), SAME); // no-break space
  assert.equal(bad(['Ben Tan', 'Ben	Tan']), SAME);
});

test('payers: names with hidden characters are rejected with a plain message', () => {
  const bad = (payers) => validateSplitCreateRequest(validSplitBody({ payers }));
  const HIDDEN = 'A name has hidden characters. Retype it.';
  assert.equal(bad(['Ben​', 'Bea']), HIDDEN);
  assert.equal(bad(['Ben', 'Be‍a']), HIDDEN);
  assert.equal(bad(['﻿Ben', 'Bea']), HIDDEN);
  assert.equal(bad(['Ben', 'Bea']), HIDDEN);
  assert.equal(bad(['Ben', 'Bea‮']), HIDDEN);
});

test('payers: a hidden character cannot be used to dodge the duplicate check', () => {
  const bad = (payers) => validateSplitCreateRequest(validSplitBody({ payers }));
  assert.notEqual(bad(['Ben', 'Ben​']), null);
});

test('payers: look-alike letters from another alphabet are NOT treated as duplicates (accepted residual risk)', () => {
  const ok = (payers) => validateSplitCreateRequest(validSplitBody({ payers }));
  assert.equal(ok(['Ben', 'Bеn']), null); // Cyrillic small e
});

test('resolveRosterName: matches by the shared rule (inner spaces, full-width)', () => {
  assert.equal(resolveRosterName(['Ben Tan', 'Bea'], 'ben   tan'), 'Ben Tan');
  assert.equal(resolveRosterName(['Ben', 'Bea'], 'Ｂｅｎ'), 'Ben');
});

test('claim: two names that match by the shared rule count as a duplicate inside one claim', () => {
  const body = { action: 'claim', itemId: 'i1', payer: 'Bea', sharedWith: ['bea  '] };
  assert.equal(validateClaimRequest(body), 'Duplicate names in claim');
});

// --- discount and rounding are checked on the server ---

test('validateParsedReceipt: an older scan without the new fields still passes (reads as 0)', () => {
  const parsed = validParsedReceipt();
  assert.equal(parsed.discount, undefined);
  assert.equal(validateParsedReceipt(parsed), null);
});

test('validateParsedReceipt: discount fields must be finite and not negative; rounding may be negative', () => {
  assert.equal(validateParsedReceipt(validParsedReceipt({ discount: 2, rounding: -0.02 })), null);
  assert.match(validateParsedReceipt(validParsedReceipt({ discount: -1 })), /discount/i);
  assert.match(validateParsedReceipt(validParsedReceipt({ discount: NaN })), /discount/i);
  assert.match(validateParsedReceipt(validParsedReceipt({ rounding: Infinity })), /rounding/i);
  assert.match(validateParsedReceipt(validParsedReceipt({ rounding: '0.01' })), /rounding/i);
  const bad = validParsedReceipt();
  bad.items[0].discount = -3;
  assert.match(validateParsedReceipt(bad), /item discount/i);
  const good = validParsedReceipt();
  good.items[0].discount = 3;
  assert.equal(validateParsedReceipt(good), null);
});

test('validateSplitCreateRequest: item discount, bill discount and rounding are shape-checked, absent is fine', () => {
  assert.equal(validateSplitCreateRequest(validSplitBody()), null);
  const body = validSplitBody();
  body.items[0].discount = 1;
  body.totals = { ...body.totals, discount: 0, rounding: -0.05 };
  assert.equal(validateSplitCreateRequest(body), null);
  const negItem = validSplitBody();
  negItem.items[0].discount = -1;
  assert.match(validateSplitCreateRequest(negItem), /item discount/i);
  const negBill = validSplitBody();
  negBill.totals = { ...negBill.totals, discount: -1 };
  assert.match(validateSplitCreateRequest(negBill), /discount/i);
  const badRound = validSplitBody();
  badRound.totals = { ...badRound.totals, rounding: 'x' };
  assert.match(validateSplitCreateRequest(badRound), /rounding/i);
});

const dish = (id, line_total, discount) => ({ id, name: id, category: 'food', qty: 1, unit_price: line_total, line_total, ...(discount === undefined ? {} : { discount }) });
const exactBody = (totals = {}, items) => ({
  items: items ?? [dish('a', 50, 0), dish('b', 30, 0), dish('c', 20, 0)],
  totals: { subtotal: 100, service_charge: 9, tax: 5.94, discount: 10, rounding: 0.01, grand_total: 104.95, ...totals },
});

test('receiptExactnessError: a bill that adds up exactly is allowed', () => {
  assert.equal(receiptExactnessError(exactBody()), null);
});

test('receiptExactnessError: one sen out, either way, is refused with a code and no tolerance', () => {
  for (const grand of [104.96, 104.94]) {
    const refusal = receiptExactnessError(exactBody({ grand_total: grand }));
    assert.equal(refusal.code, 'receipt_does_not_add_up');
    assert.match(refusal.error, /do not add up/);
  }
});

test('receiptExactnessError: a payload with none of the new fields is not checked', () => {
  const old = { items: [dish('a', 10)], totals: { subtotal: 10, service_charge: 0, tax: 0, grand_total: 999 } };
  assert.equal(receiptExactnessError(old), null);
});

test('receiptExactnessError: an item discount above its price is refused; equal is allowed', () => {
  const over = receiptExactnessError(exactBody({ discount: 0, rounding: 0, grand_total: 109.2, service_charge: 9.2, tax: 0 }, [dish('a', 40, 41), dish('b', 60, 0)]));
  assert.equal(over.code, 'discount_exceeds_item');
  const free = receiptExactnessError(exactBody({ discount: 0, rounding: 0, grand_total: 60, service_charge: 0, tax: 0 }, [dish('a', 40, 40), dish('b', 60, 0)]));
  assert.equal(free, null);
});

test('receiptExactnessError: a bill discount above the items total is refused; equal is allowed', () => {
  const over = receiptExactnessError(exactBody({ discount: 100.01, grand_total: 14.93 }));
  assert.equal(over.code, 'bill_discount_exceeds_items');
  const equal = receiptExactnessError(exactBody({ discount: 100, rounding: 0, grand_total: 14.94 }));
  assert.equal(equal, null);
});

test('receiptExactnessError: a negative item price is refused', () => {
  const refusal = receiptExactnessError(exactBody({ discount: 0, rounding: 0, grand_total: 114.94 - 55 }, [dish('a', -5, 0), dish('b', 60, 0)]));
  assert.equal(refusal.code, 'negative_item_line');
});

test('validateSplitCreateRequest: the saved rounding flag must be true or false when present', () => {
  const body = validSplitBody();
  body.totals = { ...body.totals, rounding: 0.02, rounding_edited: true };
  assert.equal(validateSplitCreateRequest(body), null);
  body.totals = { ...body.totals, rounding_edited: 'yes' };
  assert.match(validateSplitCreateRequest(body), /rounding flag/i);
});

// ---- the host's acknowledgement of a difference on the receipt ----------
// exactBody() adds up to 104.95. Raising the printed grand total by 3 sen
// leaves a difference of +3 sen; lowering it leaves -3 sen.
const gapBody = (gapCents, mark = {}) =>
  exactBody({ grand_total: (10495 + gapCents) / 100, ...mark });
const tick = (gapCents) => ({ receipt_gap_cents: gapCents, receipt_gap_acknowledged: true });

test('receiptExactnessError: a difference with the tick and the exact stated amount is accepted, either sign', () => {
  for (const gap of [3, -3, 1, -100]) {
    assert.equal(receiptExactnessError(gapBody(gap, tick(gap))), null, `gap ${gap}`);
  }
});

test('receiptExactnessError: a difference without the tick is refused', () => {
  assert.equal(receiptExactnessError(gapBody(3)).code, 'receipt_does_not_add_up');
  assert.equal(
    receiptExactnessError(gapBody(3, { receipt_gap_acknowledged: false, receipt_gap_cents: 3 })).code,
    'receipt_does_not_add_up'
  );
  assert.equal(receiptExactnessError(gapBody(3, { receipt_gap_acknowledged: true })).code, 'receipt_does_not_add_up');
});

test('receiptExactnessError: a tick with the wrong amount or the wrong sign is refused', () => {
  assert.equal(receiptExactnessError(gapBody(3, tick(2))).code, 'receipt_does_not_add_up');
  assert.equal(receiptExactnessError(gapBody(3, tick(-3))).code, 'receipt_does_not_add_up');
  assert.equal(receiptExactnessError(gapBody(3, tick(0))).code, 'receipt_does_not_add_up');
});

test('receiptExactnessError: a tick when the receipt adds up is refused', () => {
  assert.equal(receiptExactnessError(exactBody({ receipt_gap_acknowledged: true })).code, 'receipt_does_not_add_up');
  assert.equal(receiptExactnessError(exactBody(tick(0))).code, 'receipt_does_not_add_up');
  assert.equal(receiptExactnessError(exactBody({ receipt_gap_cents: 5 })).code, 'receipt_does_not_add_up');
});

test('receiptExactnessError: every impossible figure is refused even with the tick', () => {
  const overItem = exactBody({ discount: 0, rounding: 0, grand_total: 109.2 + 0.03, service_charge: 9.2, tax: 0, ...tick(3) }, [dish('a', 40, 41), dish('b', 60, 0)]);
  assert.equal(receiptExactnessError(overItem).code, 'discount_exceeds_item');
  const overBill = exactBody({ discount: 100.01, grand_total: 14.93 + 0.03, ...tick(3) });
  assert.equal(receiptExactnessError(overBill).code, 'bill_discount_exceeds_items');
  const negative = exactBody({ discount: 0, rounding: 0, grand_total: 114.94 - 55 + 0.03, ...tick(3) }, [dish('a', -5, 0), dish('b', 60, 0)]);
  assert.equal(receiptExactnessError(negative).code, 'negative_item_line');
});

test('receiptExactnessError: an older payload is not checked, whatever difference fields it carries', () => {
  const old = { items: [dish('a', 10)], totals: { subtotal: 10, service_charge: 0, tax: 0, grand_total: 999, receipt_gap_acknowledged: true } };
  assert.equal(receiptExactnessError(old), null);
});

test('stampReceiptGap: the server writes its own figure and drops anything the client sent', () => {
  const stamped = stampReceiptGap(gapBody(3, tick(3)));
  assert.equal(stamped.receipt_gap_cents, 3);
  assert.equal(stamped.receipt_gap_acknowledged, true);
  // A clean receipt, or an older payload: no marker at all.
  assert.equal('receipt_gap_cents' in stampReceiptGap(exactBody()), false);
  assert.equal('receipt_gap_acknowledged' in stampReceiptGap(exactBody({ receipt_gap_cents: 9 })), false);
  const old = { items: [dish('a', 10)], totals: { subtotal: 10, service_charge: 0, tax: 0, grand_total: 10, receipt_gap_cents: 4, receipt_gap_acknowledged: true } };
  assert.equal('receipt_gap_cents' in stampReceiptGap(old), false);
  // Not mutated.
  const body = gapBody(3, tick(3));
  stampReceiptGap(body);
  assert.equal(body.totals.receipt_gap_cents, 3);
});

test('validateSplitCreateRequest: the difference fields must be a boolean and a whole number when present', () => {
  const body = validSplitBody();
  body.totals = { ...body.totals, ...tick(3) };
  assert.equal(validateSplitCreateRequest(body), null);
  body.totals = { ...body.totals, receipt_gap_acknowledged: 'yes' };
  assert.match(validateSplitCreateRequest(body), /difference flag/i);
  body.totals = { ...body.totals, receipt_gap_acknowledged: true, receipt_gap_cents: 1.5 };
  assert.match(validateSplitCreateRequest(body), /difference/i);
  body.totals = { ...body.totals, receipt_gap_cents: '3' };
  assert.match(validateSplitCreateRequest(body), /difference/i);
});
