// api/split.patch.totals-recompute.test.mjs — Item 21 Step 4 end to end,
// through the REAL PATCH handler (api/split.js) and the REAL data-access
// layer (api/_lib/supabase.js, including its REAL claimSplitItem recompute
// wiring). Only the raw @supabase/supabase-js SDK is stubbed — this is the
// seam every other layer of this codebase treats as the boundary of what it
// owns (api/_lib/supabase.js's own docstring: "the ONLY file that imports
// @supabase/supabase-js").
//
// This closes the exact gap Item 24 Step 8 flagged as accepted: a claim
// changed `assignments` but the split's OWN STORED `totals` field did not
// reflect it until Item 21 Step 4 landed. Everything here reads `totals`
// back off the (fake) database row, never off a client-side preview.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let row = null;

require.cache[require.resolve('@supabase/supabase-js')] = {
  id: require.resolve('@supabase/supabase-js'),
  filename: require.resolve('@supabase/supabase-js'),
  loaded: true,
  exports: {
    createClient: () => ({
      from: () => ({
        select: (columns) => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row ? { ...row } : null, error: null }),
          }),
        }),
        update: (patch) => {
          const filters = {};
          const chain = {
            eq: (column, value) => {
              filters[column] = value;
              return chain;
            },
            select: async () => {
              if (row && row.id === filters.id && row.version === filters.version) {
                Object.assign(row, patch);
                return {
                  data: [{ assignments: row.assignments, totals: row.totals, version: row.version }],
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          };
          return chain;
        },
      }),
    }),
  },
};
process.env.SUPABASE_URL = 'http://stub';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';

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

async function call(method, body, id = 'abc') {
  const res = fakeRes();
  const errors = console.error;
  console.error = () => {};
  try {
    await handler({ method, query: id === null ? {} : { id }, body }, res);
  } finally {
    console.error = errors;
  }
  return res;
}
const patch = (body, id) => call('PATCH', body, id);
const get = (id) => call('GET', undefined, id);
const claim = (payer, itemId = 'i1', extra = {}) => ({ action: 'claim', itemId, payer, ...extra });

const savedClaimsEnabled = process.env.CLAIMS_ENABLED;
afterEach(() => {
  if (savedClaimsEnabled === undefined) delete process.env.CLAIMS_ENABLED;
  else process.env.CLAIMS_ENABLED = savedClaimsEnabled;
});

beforeEach(() => {
  process.env.CLAIMS_ENABLED = 'true';
  row = {
    id: 'abc',
    items: [
      { id: 'i1', name: 'Nasi', category: 'food', qty: 1, unit_price: 20, line_total: 20 },
      { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 4, line_total: 4 },
    ],
    // A tax+service charge on the bill exercises the pro-rata apportionment,
    // not just the item cents.
    totals: { subtotal: 24, service_charge: 2.4, tax: 1.44, grand_total: 27.84, per_person: {} },
    assignments: {},
    payers: ['Ali', 'Bea'],
    version: 0,
  };
});

test('claim: the SPLIT ROW stored totals reflect the claim, not just a client preview (Item 24 Step 8 gap)', async () => {
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 200);
  // The PATCH response and — critically — what a fresh GET of the split
  // returns (i.e. what is actually stored) must agree, and must show Ali
  // charged for i1 with i1's pro-rata share of tax/service.
  const fresh = await get('abc');
  assert.deepEqual(fresh.body.totals.per_person, res.body.totals.per_person);
  assert.ok(fresh.body.totals.per_person.Ali > 0, 'Ali is charged in the STORED row, not just a preview');
  assert.equal(fresh.body.totals.per_person.Bea, 0);
  // i1 (RM20) is claimed, i2 (RM4) is not: unclaimed items = 4.
  assert.equal(fresh.body.totals.unclaimed_items, 4);
  // Whole bill ties out: per-person + unclaimed = grand_total, in the STORED row.
  const sum = Object.values(fresh.body.totals.per_person).reduce((a, c) => a + c, 0);
  assert.equal(Math.round((sum + fresh.body.totals.unclaimed) * 100), 2784);
});

test('un-claim: the stored totals revert (item becomes unclaimed, nobody charged)', async () => {
  await patch(claim('Ali'));
  const before = (await get('abc')).body.totals;
  assert.ok(before.per_person.Ali > 0);

  const res = await patch({ action: 'unclaim', itemId: 'i1', payer: 'Ali' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totals.per_person.Ali, 0);
  assert.equal(res.body.totals.per_person.Bea, 0);
  assert.equal(res.body.totals.unclaimed_items, 24); // both items now unclaimed

  const after = await get('abc');
  assert.deepEqual(after.body.totals, res.body.totals); // stored, not just returned
});

test('shared claim: the stored totals split the item and its tax/service correctly between claimants', async () => {
  const res = await patch(claim('Ali', 'i1', { sharedWith: ['Bea'] }));
  assert.equal(res.statusCode, 200);
  const fresh = (await get('abc')).body.totals;
  assert.deepEqual(fresh.per_person, res.body.totals.per_person);
  assert.ok(fresh.per_person.Ali > 0 && fresh.per_person.Bea > 0, 'both claimants are charged');
  assert.equal(fresh.per_person.Ali, fresh.per_person.Bea); // RM20 split evenly, no odd remainder
});

test('CAS retry-on-conflict still works with the totals recompute folded in: ten repeated same-item collisions, one winner each time, stored totals always match the applied claim', async () => {
  for (let run = 0; run < 10; run += 1) {
    row.assignments = {};
    row.version = 0;
    row.totals = { ...row.totals, per_person: {} };
    const [a, b] = await Promise.all([patch(claim('Ali')), patch(claim('Bea'))]);
    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(statuses, [200, 409], `run ${run}`);
    const winner = a.statusCode === 200 ? a : b;
    const winnerName = winner.body.assignments.i1.equal[0];
    // The STORED row (a fresh GET) matches exactly the claim that actually applied.
    const fresh = await get('abc');
    assert.deepEqual(fresh.body.assignments, winner.body.assignments, `run ${run}`);
    assert.deepEqual(fresh.body.totals.per_person, winner.body.totals.per_person, `run ${run}`);
    assert.ok(fresh.body.totals.per_person[winnerName] > 0, `run ${run}`);
    const loserName = winnerName === 'Ali' ? 'Bea' : 'Ali';
    assert.equal(fresh.body.totals.per_person[loserName], 0, `run ${run}`);
  }
});

test('two concurrent claims on DIFFERENT items both succeed and the stored totals reflect both, consistently', async () => {
  const [a, b] = await Promise.all([patch(claim('Ali', 'i1')), patch(claim('Bea', 'i2'))]);
  assert.deepEqual([a.statusCode, b.statusCode], [200, 200]);
  const fresh = (await get('abc')).body.totals;
  assert.ok(fresh.per_person.Ali > 0);
  assert.ok(fresh.per_person.Bea > 0);
  assert.equal(fresh.unclaimed, 0);
  const sum = Object.values(fresh.per_person).reduce((s, c) => s + c, 0);
  assert.equal(Math.round((sum + fresh.unclaimed) * 100), 2784);
});
