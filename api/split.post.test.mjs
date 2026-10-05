// api/split.post.test.mjs — POST /api/split end to end through the real
// handler, with the data-access layer replaced by an in-memory stub.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const supabasePath = require.resolve('./_lib/supabase.js');

const stored = [];
let splitRow = null;
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    createSplit: async (row) => {
      stored.push(row);
    },
    getSplit: async () => splitRow,
    insertAnalyticsRows: async () => {},
  },
};
// Item 10 Step 8: the auth layer is stubbed. requireAccount mirrors its
// contract (accountId on success; 401 session_expired and null otherwise) so
// these tests prove the handler's wiring, not Supabase. The real requireAccount
// is covered by api/_lib/auth.test.mjs.
const authPath = require.resolve('./_lib/auth.js');
let authAccountId = 'acct-1';
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAccount: async (req, res) => {
      if (authAccountId) return authAccountId;
      res.status(401).json({ error: 'Please sign in to scan a receipt.', code: 'session_expired' });
      return null;
    },
  },
};

const handler = require('./split.js');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    raw: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.raw = JSON.stringify(payload);
      return this;
    },
  };
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const GENERIC_400_RAW = '{"error":"Bad Request"}';

function postBody(overrides = {}) {
  return {
    items: [
      { id: 'i1', name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 10, line_total: 10 },
      { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 4, line_total: 4 },
    ],
    assignments: { i1: ['Ali', 'Bea'], i2: ['Bea'] },
    payers: ['Ali', 'Bea'],
    totals: {
      subtotal: 14,
      service_charge: 1.4,
      tax: 0.84,
      grand_total: 16.24,
      per_person: { Ali: 5.5, Bea: 10.74 },
    },
    ownerPaymentHandle: 'DuitNow 012',
    ...overrides,
  };
}

async function post(body, headers = JSON_HEADERS) {
  const lines = { log: [], warn: [], error: [] };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(lines)) console[k] = (...a) => lines[k].push(a.join(' '));
  const res = fakeRes();
  try {
    await handler({ method: 'POST', body, headers }, res);
  } finally {
    Object.assign(console, orig);
  }
  return { res, lines };
}

beforeEach(() => {
  stored.length = 0;
  splitRow = null;
  authAccountId = 'acct-1';
});

// --- Item 10 Step 8: session gate ---

test('unsigned POST: 401 session_expired, nothing stored, and validation is never reached', async () => {
  authAccountId = null;
  // A body that would fail validation with a 400 if the gate were not first.
  const { res } = await post({ nonsense: true });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'session_expired');
  assert.equal(res.body.error, 'Please sign in to scan a receipt.');
  assert.equal(stored.length, 0);
});

test('signed-in POST: the accountId is threaded into storage as accountId', async () => {
  authAccountId = 'acct-42';
  const { res } = await post(postBody());
  assert.equal(res.statusCode, 201);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].accountId, 'acct-42');
});

test('GET stays anonymous: no session needed, and the response never carries an account id', async () => {
  authAccountId = null;
  const base = {
    id: 'abc', items: [], assignments: {}, totals: {}, owner_payment_handle: 'h', created_at: 't',
  };
  splitRow = { ...base, account_id: 'acct-42', payers: ['Ali'], version: 1 };
  const res = fakeRes();
  await handler({ method: 'GET', query: { id: 'abc' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal('account_id' in res.body, false);
  assert.equal('accountId' in res.body, false);
});

test('honest request: stored, 201, no mismatch line', async () => {
  await post(postBody());
  const honest = stored[0].totals.per_person;
  stored.length = 0;
  const { res, lines } = await post(postBody({ totals: { ...postBody().totals, per_person: honest } }));
  assert.equal(res.statusCode, 201);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].totals.per_person, honest);
  assert.equal(lines.warn.length, 0);
});

test('altered totals: accepted, stored row carries the correct figures, one mismatch line', async () => {
  const { res, lines } = await post(
    postBody({ totals: { ...postBody().totals, per_person: { Ali: 0.01, Bea: 999 } } })
  );
  assert.equal(res.statusCode, 201);
  assert.equal(stored.length, 1);
  const sum = Object.values(stored[0].totals.per_person).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum * 100), 1624);
  assert.notEqual(stored[0].totals.per_person.Bea, 999);
  const mismatchLines = lines.warn.filter((l) => l.includes('totals mismatch'));
  assert.equal(mismatchLines.length, 1);
  assert.ok(mismatchLines[0].includes(res.body.id));
});

test('payers absent: still accepted, derived from per_person, one log line', async () => {
  const b = postBody();
  delete b.payers;
  const { res, lines } = await post(b);
  assert.equal(res.statusCode, 201);
  assert.equal(stored.length, 1);
  assert.ok(lines.log.some((l) => l.includes('derived from totals.per_person')));
});

test('invalid payers are rejected with 400 and nothing is stored', async () => {
  for (const payers of ['Ali', [], ['Ali', ''], ['Ali', 'Ali'], ['Ali', 7], null]) {
    const { res } = await post(postBody({ payers }));
    assert.equal(res.statusCode, 400, JSON.stringify(payers));
  }
  assert.equal(stored.length, 0);
});

test('a totals mismatch never rejects the request', async () => {
  const { res } = await post(postBody({ totals: { ...postBody().totals, per_person: {} } }));
  assert.equal(res.statusCode, 201);
});

test('payers are passed to storage as sent', async () => {
  const { res } = await post(postBody());
  assert.equal(res.statusCode, 201);
  assert.deepEqual(stored[0].payers, ['Ali', 'Bea']);
});

test('payers absent: storage receives no payers', async () => {
  const b = postBody();
  delete b.payers;
  await post(b);
  assert.equal(stored[0].payers, undefined);
});

test('POST rejects blank, over-long, case-duplicate and over-200 rosters with 400', async () => {
  const many = Array.from({ length: 201 }, (_, i) => `P${i}`);
  for (const payers of [['Ali', ' '], ['x'.repeat(21)], ['Ali', 'ALI'], many]) {
    const { res } = await post(postBody({ payers }));
    assert.equal(res.statusCode, 400);
  }
  assert.equal(stored.length, 0);
});

test('GET returns payers and version; a row without them returns null and 0', async () => {
  const base = {
    id: 'abc', items: [], assignments: {}, totals: {}, owner_payment_handle: 'h', created_at: 't',
  };
  splitRow = { ...base, payers: ['Ali', 'Bea'], version: 3 };
  let res = fakeRes();
  await handler({ method: 'GET', query: { id: 'abc' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.payers, ['Ali', 'Bea']);
  assert.equal(res.body.version, 3);

  splitRow = { ...base };
  res = fakeRes();
  await handler({ method: 'GET', query: { id: 'abc' } }, res);
  assert.equal(res.body.payers, null);
  assert.equal(res.body.version, 0);
});

// --- Item 23: merchant_name / receipt_date ---

test('POST passes merchantName/receiptDate through to storage as merchant_name/receipt_date', async () => {
  const { res } = await post(postBody({ merchantName: 'Restoran Uncle', receiptDate: '2026-09-28' }));
  assert.equal(res.statusCode, 201);
  assert.equal(stored[0].merchantName, 'Restoran Uncle');
  assert.equal(stored[0].receiptDate, '2026-09-28');
});

test('POST without merchantName/receiptDate: storage receives undefined for both (not the column at all)', async () => {
  await post(postBody());
  assert.equal(stored[0].merchantName, undefined);
  assert.equal(stored[0].receiptDate, undefined);
});

test('POST rejects a non-string merchantName / a badly-formatted receiptDate with 400', async () => {
  let res = (await post(postBody({ merchantName: 123 }))).res;
  assert.equal(res.statusCode, 400);
  res = (await post(postBody({ receiptDate: '28-09-2026' }))).res;
  assert.equal(res.statusCode, 400);
  assert.equal(stored.length, 0);
});

test('GET returns merchant_name and receipt_date; a row without them returns null for both', async () => {
  const base = {
    id: 'abc', items: [], assignments: {}, totals: {}, owner_payment_handle: 'h', created_at: 't',
  };
  splitRow = { ...base, merchant_name: 'Restoran Uncle', receipt_date: '2026-09-28' };
  let res = fakeRes();
  await handler({ method: 'GET', query: { id: 'abc' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.merchant_name, 'Restoran Uncle');
  assert.equal(res.body.receipt_date, '2026-09-28');

  splitRow = { ...base };
  res = fakeRes();
  await handler({ method: 'GET', query: { id: 'abc' } }, res);
  assert.equal(res.body.merchant_name, null);
  assert.equal(res.body.receipt_date, null);
});

test('claimed flags in creator-submitted assignments are stripped before storing; nothing else changes', async () => {
  const forged = {
    i1: { mode: 'equal', equal: ['Ali'], manual: { unit: 'RM', values: {} }, claimed: true },
    i2: { mode: 'manual', equal: [], manual: { unit: 'RM', values: { Bea: { text: '4', cents: 400 } } }, claimed: true },
  };
  const { res } = await post(postBody({ assignments: forged }));
  assert.equal(res.statusCode, 201);
  const kept = stored[0].assignments;
  assert.equal('claimed' in kept.i1, false);
  assert.equal('claimed' in kept.i2, false);
  assert.deepEqual(kept.i1, { mode: 'equal', equal: ['Ali'], manual: { unit: 'RM', values: {} } });
  assert.deepEqual(kept.i2.manual.values, { Bea: { text: '4', cents: 400 } });
  // The caller's own object is not mutated, and plain-array assignments pass through as they were.
  assert.equal(forged.i1.claimed, true);
  await post(postBody());
  assert.deepEqual(stored[1].assignments, { i1: ['Ali', 'Bea'], i2: ['Bea'] });
});

// --- Content-Type check (generic 400, after the session gate) ---

test('split POST: wrong Content-Type (text/plain): generic 400, nothing stored', async () => {
  const { res } = await post(postBody(), { 'content-type': 'text/plain' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Bad Request' });
  assert.equal(stored.length, 0);
});

test('split POST: split validation 400 keeps its original specific message, nothing stored', async () => {
  const bad = postBody();
  bad.items[0].qty = 0;
  const { res } = await post(bad);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Invalid item quantity' });
  assert.equal(stored.length, 0);
});

test('split POST: invalid item category keeps its original specific message', async () => {
  const bad = postBody();
  bad.items[1].category = 'not-a-category';
  const { res } = await post(bad);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Invalid item category' });
  assert.equal(stored.length, 0);
});

test('split POST: application/json with charset is accepted', async () => {
  const { res } = await post(postBody(), { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(res.statusCode, 201);
  assert.equal(stored.length, 1);
});

test('split POST: missing Content-Type: generic 400, nothing stored', async () => {
  const { res } = await post(postBody(), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.raw, GENERIC_400_RAW);
  assert.equal(stored.length, 0);
});

test('split POST: unsigned with a wrong Content-Type: still 401 session_expired (gate runs first)', async () => {
  authAccountId = null;
  const { res } = await post(postBody(), { 'content-type': 'text/plain' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'session_expired');
  assert.equal(stored.length, 0);
});

test('split POST: unsigned with the right Content-Type: still 401 session_expired', async () => {
  authAccountId = null;
  const { res } = await post(postBody(), JSON_HEADERS);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'session_expired');
  assert.equal(res.body.error, 'Please sign in to scan a receipt.');
});

test('split POST: format refusals (wrong and missing Content-Type) return byte-identical 400 bodies', async () => {
  const wrongType = (await post(postBody(), { 'content-type': 'text/plain' })).res;
  const formUrlEncoded = (await post(postBody(), { 'content-type': 'application/x-www-form-urlencoded' })).res;
  const missingType = (await post(postBody(), {})).res;
  assert.equal(wrongType.statusCode, 400);
  assert.equal(formUrlEncoded.statusCode, 400);
  assert.equal(missingType.statusCode, 400);
  assert.equal(wrongType.raw, GENERIC_400_RAW);
  assert.equal(formUrlEncoded.raw, GENERIC_400_RAW);
  assert.equal(missingType.raw, GENERIC_400_RAW);
});
