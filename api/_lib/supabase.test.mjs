// api/_lib/supabase.test.mjs — createSplit / getSplit against a stubbed
// Supabase client, including a database that has not had the payers/version
// migration applied yet, and (Item 23) one that has not had the
// merchant_name/receipt_date migration applied yet — independently of each
// other, since either can land before the other on a real database.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Two independent migration flags — Item 24's payers/version columns and
// Item 23's merchant_name/receipt_date columns can each be present or absent
// on a given database regardless of the other.
let hasRosterColumns = true;
let hasReceiptColumns = true;
let stateRow = null;
const calls = [];

function missingColumnError(column) {
  return { code: '42703', message: `column splits.${column} does not exist` };
}

const sdkPath = require.resolve('@supabase/supabase-js');
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: {
    createClient: () => ({
      from: () => ({
        insert: (row) => ({
          select: () => ({
            single: async () => {
              calls.push({ op: 'insert', row });
              if (!hasRosterColumns && 'payers' in row) {
                return { data: null, error: missingColumnError('payers') };
              }
              if (!hasReceiptColumns && ('merchant_name' in row || 'receipt_date' in row)) {
                return { data: null, error: missingColumnError('merchant_name') };
              }
              return { data: { ...row }, error: null };
            },
          }),
        }),
        update: (patch) => {
          const filters = {};
          const chain = {
            eq: (column, value) => {
              filters[column] = value;
              return chain;
            },
            select: async (columns) => {
              calls.push({ op: 'update', patch, filters: { ...filters }, columns });
              if (!hasRosterColumns) {
                return { data: null, error: { code: '42703', message: 'column splits.version does not exist' } };
              }
              if (stateRow && stateRow.id === filters.id && stateRow.version === filters.version) {
                Object.assign(stateRow, patch);
                return {
                  data: [{ assignments: stateRow.assignments, totals: stateRow.totals, version: stateRow.version }],
                  error: null,
                };
              }
              return { data: [], error: null };
            },
          };
          return chain;
        },
        select: (columns) => ({
          eq: () => ({
            maybeSingle: async () => {
              calls.push({ op: 'select', columns });
              if (!hasReceiptColumns && /merchant_name|receipt_date/.test(columns)) {
                return { data: null, error: missingColumnError('merchant_name') };
              }
              if (!hasRosterColumns && /payers|version/.test(columns)) {
                return { data: null, error: missingColumnError('payers') };
              }
              const row = { id: 'x', items: [], assignments: {}, totals: {}, owner_payment_handle: 'h', created_at: 't', expires_at: null };
              const withRoster = hasRosterColumns ? { ...row, payers: ['A', 'B'], version: 0 } : row;
              const withReceipt =
                hasReceiptColumns && /merchant_name|receipt_date/.test(columns)
                  ? { ...withRoster, merchant_name: 'Restoran Uncle', receipt_date: '2026-09-30' }
                  : withRoster;
              return { data: withReceipt, error: null };
            },
          }),
        }),
      }),
    }),
  },
};
process.env.SUPABASE_URL = 'http://stub';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
const { createSplit, getSplit, claimSplitItem } = require('./supabase.js');

const base = { id: 'x', items: [], assignments: {}, totals: {}, ownerPaymentHandle: 'h', expiresAt: 't' };

beforeEach(() => {
  calls.length = 0;
  hasRosterColumns = true;
  hasReceiptColumns = true;
  stateRow = { id: 'x', assignments: { i1: [] }, totals: { grand_total: 10 }, version: 4 };
});

test('createSplit stores payers and leaves version to the column default', async () => {
  await createSplit({ ...base, payers: ['A', 'B'] });
  assert.deepEqual(calls[0].row.payers, ['A', 'B']);
  assert.equal('version' in calls[0].row, false);
});

test('createSplit without payers does not send the payers column', async () => {
  await createSplit(base);
  assert.equal('payers' in calls[0].row, false);
  assert.equal(calls.length, 1);
});

test('getSplit selects payers and version and returns them', async () => {
  const row = await getSplit('x');
  assert.match(calls[0].columns, /payers, version/);
  assert.deepEqual(row.payers, ['A', 'B']);
  assert.equal(row.version, 0);
});

test('migration not applied: createSplit retries without payers and succeeds', async () => {
  hasRosterColumns = false;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const row = await createSplit({ ...base, payers: ['A', 'B'] });
    assert.equal(row.id, 'x');
    assert.equal(calls.length, 2);
    assert.equal('payers' in calls[1].row, false);
  } finally {
    console.warn = warn;
  }
});

test('migration not applied: getSplit falls back to the original columns (both migrations missing)', async () => {
  hasRosterColumns = false;
  hasReceiptColumns = false;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const row = await getSplit('x');
    assert.equal(row.id, 'x');
    assert.equal(row.payers, undefined);
    assert.equal(row.merchant_name, undefined);
    // Three read attempts: full -> roster-only (still fails, roster is also
    // missing) -> bare SPLIT_COLUMNS (succeeds).
    assert.equal(calls.length, 3);
    assert.doesNotMatch(calls[2].columns, /payers|version|merchant_name|receipt_date/);
  } finally {
    console.warn = warn;
  }
});

// Item 23 — merchant_name/receipt_date. Both new tests below exercise the
// column set independently of payers/version, per D4's persistence spec and
// this item's graceful-fallback requirement (real split rows exist
// post-Item-24, so this item cannot assume its own migration landed first).

test('createSplit stores merchant_name and receipt_date when provided', async () => {
  const row = await createSplit({ ...base, merchantName: 'Restoran Uncle', receiptDate: '2026-09-28' });
  assert.equal(calls[0].row.merchant_name, 'Restoran Uncle');
  assert.equal(calls[0].row.receipt_date, '2026-09-28');
  assert.equal(row.merchant_name, 'Restoran Uncle');
});

test('createSplit stores an explicit null (read but illegible) rather than omitting the column', async () => {
  await createSplit({ ...base, merchantName: null, receiptDate: null });
  assert.equal('merchant_name' in calls[0].row, true);
  assert.equal(calls[0].row.merchant_name, null);
  assert.equal(calls[0].row.receipt_date, null);
});

test('createSplit without merchantName/receiptDate does not send those columns', async () => {
  await createSplit(base);
  assert.equal('merchant_name' in calls[0].row, false);
  assert.equal('receipt_date' in calls[0].row, false);
  assert.equal(calls.length, 1);
});

test('getSplit selects merchant_name and receipt_date and returns them', async () => {
  const row = await getSplit('x');
  assert.match(calls[0].columns, /merchant_name, receipt_date/);
  assert.equal(row.merchant_name, 'Restoran Uncle');
  assert.equal(row.receipt_date, '2026-09-30');
});

test('receipt migration not applied (roster migration IS applied): createSplit retries without merchant_name/receipt_date and keeps payers', async () => {
  hasReceiptColumns = false;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const row = await createSplit({ ...base, payers: ['A', 'B'], merchantName: 'Restoran Uncle', receiptDate: '2026-09-28' });
    assert.equal(row.id, 'x');
    assert.equal(calls.length, 2);
    assert.equal('merchant_name' in calls[1].row, false);
    assert.deepEqual(calls[1].row.payers, ['A', 'B']);
  } finally {
    console.warn = warn;
  }
});

test('receipt migration not applied (roster migration IS applied): getSplit falls back to roster columns only, in one retry', async () => {
  hasReceiptColumns = false;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const row = await getSplit('x');
    assert.equal(row.id, 'x');
    assert.equal(row.merchant_name, undefined);
    assert.deepEqual(row.payers, ['A', 'B']);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(calls[1].columns, /merchant_name|receipt_date/);
    assert.match(calls[1].columns, /payers, version/);
  } finally {
    console.warn = warn;
  }
});

test('neither migration applied: createSplit cascades all the way down to the bare row', async () => {
  hasRosterColumns = false;
  hasReceiptColumns = false;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const row = await createSplit({ ...base, payers: ['A', 'B'], merchantName: 'Restoran Uncle', receiptDate: '2026-09-28' });
    assert.equal(row.id, 'x');
    assert.equal(calls.length, 3);
    assert.equal('merchant_name' in calls[2].row, false);
    assert.equal('payers' in calls[2].row, false);
  } finally {
    console.warn = warn;
  }
});

// Item 21 Step 4: claimSplitItem recomputes `totals` from the new
// assignments (via api/_lib/recompute.js's computeClaimTotals, itself a thin
// wrapper over api/_lib/totals.js's computeTotals — the same arithmetic the
// POST path and the browser preview use) and writes it in the SAME update()
// call as `assignments`, guarded by the same `version` compare-and-swap.
const items = [{ id: 'i1', name: 'Nasi', category: 'food', qty: 1, unit_price: 10, line_total: 10 }];
const payers = ['A', 'B'];
const billTotals = { subtotal: 10, service_charge: 0, tax: 0, grand_total: 10 };

test('claimSplitItem: applies at the expected version, bumps it by one, and recomputes totals in the SAME write', async () => {
  const next = { i1: { mode: 'equal', equal: ['A'] } };
  const row = await claimSplitItem('x', 4, next, items, payers, billTotals);
  assert.deepEqual(row.assignments, next);
  assert.equal(row.version, 5);
  // The recomputed totals: A holds i1 (RM10) in full, B holds nothing;
  // nothing is unclaimed (the only item is assigned).
  assert.deepEqual(row.totals.per_person, { A: 10, B: 0 });
  assert.equal(row.totals.unclaimed, 0);
  assert.equal(row.totals.unclaimed_items, 0);
  // The receipt-level fields are carried through unchanged.
  assert.equal(row.totals.subtotal, 10);
  assert.equal(row.totals.grand_total, 10);
  assert.deepEqual(calls[0].filters, { id: 'x', version: 4 });
  // The write is one statement: assignments, totals and version together.
  assert.deepEqual(Object.keys(calls[0].patch).sort(), ['assignments', 'totals', 'version']);
  assert.deepEqual(calls[0].patch.totals.per_person, { A: 10, B: 0 });
  assert.equal(stateRow.version, 5);
  assert.deepEqual(stateRow.totals.per_person, { A: 10, B: 0 });
});

test('claimSplitItem: an un-claim (item now unassigned) recomputes totals to nobody charged and the item unclaimed', async () => {
  // A had claimed i1; now nobody does.
  const row = await claimSplitItem('x', 4, {}, items, payers, billTotals);
  assert.deepEqual(row.totals.per_person, { A: 0, B: 0 });
  assert.equal(row.totals.unclaimed, 10);
  assert.equal(row.totals.unclaimed_items, 10);
});

test('claimSplitItem: a shared claim splits the recomputed total correctly', async () => {
  const next = { i1: { mode: 'equal', equal: ['A', 'B'] } };
  const row = await claimSplitItem('x', 4, next, items, payers, billTotals);
  assert.deepEqual(row.totals.per_person, { A: 5, B: 5 });
  assert.equal(row.totals.unclaimed, 0);
});

test('claimSplitItem: a stale version changes nothing, recomputes nothing stored, and returns null', async () => {
  const row = await claimSplitItem('x', 3, { i1: ['A'] }, items, payers, billTotals);
  assert.equal(row, null);
  assert.deepEqual(stateRow.assignments, { i1: [] });
  assert.equal(stateRow.version, 4);
  assert.deepEqual(stateRow.totals, { grand_total: 10 }); // untouched: the CAS matched zero rows
});

test('claimSplitItem: two writers from the same version, exactly one wins, and its totals are what land', async () => {
  const [a, b] = await Promise.all([
    claimSplitItem('x', 4, { i1: { mode: 'equal', equal: ['A'] } }, items, payers, billTotals),
    claimSplitItem('x', 4, { i1: { mode: 'equal', equal: ['B'] } }, items, payers, billTotals),
  ]);
  const results = [a, b].filter(Boolean);
  assert.equal(results.length, 1);
  assert.equal(stateRow.version, 5);
  // Whichever assignment actually landed, its totals (not the loser's) are
  // what is stored: exactly the winning claimant is charged the RM10, the
  // other pays nothing.
  const winner = results[0];
  const winnerName = winner.assignments.i1.equal[0];
  assert.equal(winner.totals.per_person[winnerName], 10);
  const otherName = winnerName === 'A' ? 'B' : 'A';
  assert.equal(winner.totals.per_person[otherName], 0);
  assert.deepEqual(stateRow.totals.per_person, winner.totals.per_person);
});

test('claimSplitItem: called with no items/payers/billTotals (legacy call shape) does not throw', async () => {
  // Defensive defaults only — real production callers (api/split.js) always
  // pass the real split's items/payers/totals.
  const row = await claimSplitItem('x', 4, { i1: ['A'] });
  assert.equal(row.version, 5);
  assert.deepEqual(row.totals.per_person, {});
});

test('claimSplitItem: a database error is thrown, not swallowed', async () => {
  hasRosterColumns = false;
  await assert.rejects(
    () => claimSplitItem('x', 4, {}, items, payers, billTotals),
    (e) => e.code === '42703'
  );
});
