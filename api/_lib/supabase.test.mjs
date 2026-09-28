// api/_lib/supabase.test.mjs — createSplit / getSplit against a stubbed
// Supabase client, including a database that has not had the payers/version
// migration applied yet.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let hasNewColumns = true;
let stateRow = null;
const calls = [];
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
              if (!hasNewColumns && 'payers' in row) {
                return {
                  data: null,
                  error: { code: 'PGRST204', message: 'Could not find the payers column of splits in the schema cache' },
                };
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
              if (!hasNewColumns) {
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
              if (!hasNewColumns && /payers|version/.test(columns)) {
                return { data: null, error: { code: '42703', message: 'column splits.payers does not exist' } };
              }
              const row = { id: 'x', items: [], assignments: {}, totals: {}, owner_payment_handle: 'h', created_at: 't', expires_at: null };
              return { data: hasNewColumns ? { ...row, payers: ['A', 'B'], version: 0 } : row, error: null };
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
  hasNewColumns = true;
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
  hasNewColumns = false;
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

test('migration not applied: getSplit falls back to the original columns', async () => {
  hasNewColumns = false;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const row = await getSplit('x');
    assert.equal(row.id, 'x');
    assert.equal(row.payers, undefined);
    assert.equal(calls.length, 2);
    assert.doesNotMatch(calls[1].columns, /payers|version/);
  } finally {
    console.warn = warn;
  }
});

test('claimSplitItem: applies at the expected version and bumps it by one', async () => {
  const next = { i1: { mode: 'equal', equal: ['A'] } };
  const row = await claimSplitItem('x', 4, next);
  assert.deepEqual(row, { assignments: next, totals: { grand_total: 10 }, version: 5 });
  assert.deepEqual(calls[0].filters, { id: 'x', version: 4 });
  assert.deepEqual(Object.keys(calls[0].patch).sort(), ['assignments', 'version']);
  assert.equal(stateRow.version, 5);
});

test('claimSplitItem: a stale version changes nothing and returns null', async () => {
  const row = await claimSplitItem('x', 3, { i1: ['A'] });
  assert.equal(row, null);
  assert.deepEqual(stateRow.assignments, { i1: [] });
  assert.equal(stateRow.version, 4);
});

test('claimSplitItem: two writers from the same version, exactly one wins', async () => {
  const [a, b] = await Promise.all([
    claimSplitItem('x', 4, { i1: ['A'] }),
    claimSplitItem('x', 4, { i1: ['B'] }),
  ]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal(stateRow.version, 5);
});

test('claimSplitItem: a database error is thrown, not swallowed', async () => {
  hasNewColumns = false;
  await assert.rejects(
    () => claimSplitItem('x', 4, {}),
    (e) => e.code === '42703'
  );
});
