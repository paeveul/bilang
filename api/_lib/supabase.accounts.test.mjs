// api/_lib/supabase.accounts.test.mjs — Item 10 Checkpoint 2, Step 7.
//
// upsertAccount / recordTermsAcceptance / deleteOrphanedAccount against a
// stubbed Supabase client. A separate file from supabase.test.mjs so its own
// `.from()` mock (branching on table name: accounts / terms_acceptances) does
// not have to be reconciled with the existing splits-only mock there — each
// test file runs in its own Node test-runner subprocess, so the two
// require.cache stubs for @supabase/supabase-js never collide.
//
// Run: node --test api/_lib/supabase.accounts.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let accountsTable; // Map<id, {id, created_at}>
let termsRows; // array of inserted terms_acceptances rows
const calls = [];

function uniqueViolation() {
  return { code: '23505', message: 'duplicate key value violates unique constraint' };
}

const sdkPath = require.resolve('@supabase/supabase-js');
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: {
    createClient: () => ({
      from: (table) => {
        if (table === 'accounts') {
          return {
            insert: (row) => ({
              select: () => ({
                single: async () => {
                  calls.push({ op: 'accounts.insert', row });
                  if (accountsTable.has(row.id)) {
                    return { data: null, error: uniqueViolation() };
                  }
                  const stored = { id: row.id, created_at: new Date().toISOString() };
                  accountsTable.set(row.id, stored);
                  return { data: stored, error: null };
                },
              }),
            }),
            select: () => ({
              eq: (column, value) => ({
                single: async () => {
                  calls.push({ op: 'accounts.select', value });
                  const found = accountsTable.get(value);
                  return found ? { data: found, error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } };
                },
              }),
            }),
            delete: () => ({
              eq: (column, value) => {
                calls.push({ op: 'accounts.delete', value });
                accountsTable.delete(value);
                return Promise.resolve({ error: null });
              },
            }),
            update: (patch) => ({
              eq: (column, value) => {
                calls.push({ op: 'accounts.update', value, patch });
                const existing = accountsTable.get(value);
                if (!existing) return Promise.resolve({ error: { code: 'PGRST116', message: 'not found' } });
                accountsTable.set(value, { ...existing, ...patch });
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        if (table === 'terms_acceptances') {
          return {
            insert: (row) => {
              calls.push({ op: 'terms_acceptances.insert', row });
              termsRows.push(row);
              return Promise.resolve({ error: null });
            },
          };
        }
        throw new Error(`unexpected table in mock: ${table}`);
      },
    }),
  },
};

beforeEach(() => {
  accountsTable = new Map();
  termsRows = [];
  calls.length = 0;
  process.env.SUPABASE_URL = 'https://mock.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
});

function freshModule() {
  const modPath = require.resolve('./supabase.js');
  delete require.cache[modPath];
  return require('./supabase.js');
}

test('upsertAccount: a brand-new id is inserted and reported as inserted:true', async () => {
  const { upsertAccount } = freshModule();
  const result = await upsertAccount('user-1');
  assert.equal(result.inserted, true);
  assert.equal(result.account.id, 'user-1');
});

test('upsertAccount: an existing id is detected (unique violation) and reported as inserted:false', async () => {
  const { upsertAccount } = freshModule();
  await upsertAccount('user-2');
  const second = await upsertAccount('user-2');
  assert.equal(second.inserted, false);
  assert.equal(second.account.id, 'user-2');
});

test('upsertAccount: propagates a non-unique-violation error', async () => {
  const { upsertAccount } = freshModule();
  accountsTable = {
    has: () => { throw Object.assign(new Error('connection reset'), { code: '08006' }); },
  };
  await assert.rejects(() => upsertAccount('user-3'));
});

test('recordTermsAcceptance: inserts a signup-kind row with the given version', async () => {
  const { recordTermsAcceptance } = freshModule();
  await recordTermsAcceptance('user-4', '2026-09-23');
  assert.equal(termsRows.length, 1);
  assert.deepEqual(termsRows[0], { account_id: 'user-4', terms_kind: 'signup', terms_version: '2026-09-23' });
});

test('deleteOrphanedAccount: removes the account row', async () => {
  const { upsertAccount, deleteOrphanedAccount } = freshModule();
  await upsertAccount('user-5');
  assert.equal(accountsTable.has('user-5'), true);
  await deleteOrphanedAccount('user-5');
  assert.equal(accountsTable.has('user-5'), false);
});

test('D15 end-to-end shape: insert then terms-acceptance succeeds and leaves both rows present', async () => {
  const { upsertAccount, recordTermsAcceptance } = freshModule();
  const result = await upsertAccount('user-6');
  assert.equal(result.inserted, true);
  await recordTermsAcceptance('user-6', '2026-09-23');
  assert.equal(accountsTable.has('user-6'), true);
  assert.equal(termsRows.length, 1);
});

test('D15 rollback shape: if terms-acceptance insert fails after a fresh insert, deleteOrphanedAccount leaves no accounts row', async () => {
  const mod = freshModule();
  const result = await mod.upsertAccount('user-7');
  assert.equal(result.inserted, true);
  // Simulate recordTermsAcceptance failing by calling delete directly, the
  // way api/auth/verify-code.js's rollback path does on a caught error.
  await mod.deleteOrphanedAccount('user-7');
  assert.equal(accountsTable.has('user-7'), false);
});

// --- terms_version_seen (Tony's approved MVP1 "cheap half", 2026-10-10) ----

test('getTermsVersionSeen: a freshly-inserted account with no seen version yet reads back undefined/null', async () => {
  const mod = freshModule();
  await mod.upsertAccount('user-8');
  const seen = await mod.getTermsVersionSeen('user-8');
  assert.ok(seen === null || seen === undefined);
});

test('updateTermsVersionSeen: writes the given version, readable back via getTermsVersionSeen', async () => {
  const mod = freshModule();
  await mod.upsertAccount('user-9');
  await mod.updateTermsVersionSeen('user-9', '0.0.0-unpublished');
  const seen = await mod.getTermsVersionSeen('user-9');
  assert.equal(seen, '0.0.0-unpublished');
});

test('updateTermsVersionSeen: a second write with a new version overwrites the first', async () => {
  const mod = freshModule();
  await mod.upsertAccount('user-10');
  await mod.updateTermsVersionSeen('user-10', 'old-version');
  await mod.updateTermsVersionSeen('user-10', 'new-version');
  const seen = await mod.getTermsVersionSeen('user-10');
  assert.equal(seen, 'new-version');
});

test('getTermsVersionSeen: propagates a database error', async () => {
  const mod = freshModule();
  accountsTable = {
    get: () => { throw Object.assign(new Error('connection reset'), { code: '08006' }); },
  };
  await assert.rejects(() => mod.getTermsVersionSeen('user-11'));
});

test('updateTermsVersionSeen: propagates a database error (e.g. unknown account)', async () => {
  const mod = freshModule();
  await assert.rejects(() => mod.updateTermsVersionSeen('no-such-user', '0.0.0-unpublished'));
});
