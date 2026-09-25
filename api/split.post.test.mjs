// api/split.post.test.mjs — POST /api/split end to end through the real
// handler, with the data-access layer replaced by an in-memory stub.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const supabasePath = require.resolve('./_lib/supabase.js');

const stored = [];
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    createSplit: async (row) => {
      stored.push(row);
    },
    getSplit: async () => null,
    insertAnalyticsRows: async () => {},
  },
};
const handler = require('./split.js');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

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

async function post(body) {
  const lines = { log: [], warn: [], error: [] };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(lines)) console[k] = (...a) => lines[k].push(a.join(' '));
  const res = fakeRes();
  try {
    await handler({ method: 'POST', body }, res);
  } finally {
    Object.assign(console, orig);
  }
  return { res, lines };
}

beforeEach(() => {
  stored.length = 0;
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
