// api/auth/session.test.mjs — Item 10 Checkpoint 2, Step 7.
//
// The real handler, with api/_lib/auth.js replaced by an in-memory stub.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const authPath = require.resolve('../_lib/auth.js');
const supabasePath = require.resolve('../_lib/supabase.js');

let readSessionResult;
let refreshSessionResult; // accountId string | null
let clearSessionCookiesCalls;
let revokeSessionUpstreamCalls;
let termsVersionSeenStore; // Map<accountId, string|null>
let updateTermsVersionSeenCalls;
let getTermsVersionSeenShouldThrow;

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    readSession: async () => readSessionResult,
    refreshSession: async () => refreshSessionResult,
    clearSessionCookies: () => {
      clearSessionCookiesCalls.push(true);
    },
    revokeSessionUpstream: async () => {
      revokeSessionUpstreamCalls.push(true);
    },
  },
};

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    getTermsVersionSeen: async (accountId) => {
      if (getTermsVersionSeenShouldThrow) throw new Error('db unreachable');
      return termsVersionSeenStore.has(accountId) ? termsVersionSeenStore.get(accountId) : null;
    },
    updateTermsVersionSeen: async (accountId, version) => {
      updateTermsVersionSeenCalls.push({ accountId, version });
      termsVersionSeenStore.set(accountId, version);
    },
  },
};

const handler = require('./session.js');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
    },
  };
}

beforeEach(() => {
  readSessionResult = { accountId: 'user-abc', needsRefresh: false };
  refreshSessionResult = null;
  clearSessionCookiesCalls = [];
  revokeSessionUpstreamCalls = [];
  termsVersionSeenStore = new Map();
  updateTermsVersionSeenCalls = [];
  getTermsVersionSeenShouldThrow = false;
  delete process.env.VITE_TERMS_VERSION;
});

test('GET with a valid session returns signedIn:true and the accountId, and never calls refresh', async () => {
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { signedIn: true, accountId: 'user-abc' });
});

test('GET with an expired access token that refreshes successfully returns signedIn:true via the refresh path', async () => {
  readSessionResult = { needsRefresh: true };
  refreshSessionResult = 'user-refreshed';
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { signedIn: true, accountId: 'user-refreshed' });
});

test('GET with no valid session and a failed refresh returns signedIn:false, never a 401', async () => {
  readSessionResult = { needsRefresh: true };
  refreshSessionResult = null;
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { signedIn: false });
});

test('DELETE revokes upstream, clears cookies, and returns 204 with no body', async () => {
  const res = fakeRes();
  await handler({ method: 'DELETE', headers: {} }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.body, null);
  assert.equal(revokeSessionUpstreamCalls.length, 1);
  assert.equal(clearSessionCookiesCalls.length, 1);
});

test('other methods return 405', async () => {
  const res = fakeRes();
  await handler({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

// --- Tony's approved MVP1 "cheap half": silent terms_version_seen sync -----

test('GET with no VITE_TERMS_VERSION set: no sync attempted, response unchanged', async () => {
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { signedIn: true, accountId: 'user-abc' });
  assert.equal(updateTermsVersionSeenCalls.length, 0);
});

test('GET with a published version that differs from the stored one: silently updated', async () => {
  process.env.VITE_TERMS_VERSION = '0.0.0-unpublished';
  termsVersionSeenStore.set('user-abc', 'some-older-version');
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { signedIn: true, accountId: 'user-abc' });
  assert.deepEqual(updateTermsVersionSeenCalls, [{ accountId: 'user-abc', version: '0.0.0-unpublished' }]);
});

test('GET with a published version that already matches the stored one: no write', async () => {
  process.env.VITE_TERMS_VERSION = '0.0.0-unpublished';
  termsVersionSeenStore.set('user-abc', '0.0.0-unpublished');
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(updateTermsVersionSeenCalls.length, 0);
});

test('GET with a first-time account (no seen version stored, null): the published version is written', async () => {
  process.env.VITE_TERMS_VERSION = '0.0.0-unpublished';
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updateTermsVersionSeenCalls, [{ accountId: 'user-abc', version: '0.0.0-unpublished' }]);
});

test('GET via the refresh path also triggers the sync, keyed on the refreshed accountId', async () => {
  readSessionResult = { needsRefresh: true };
  refreshSessionResult = 'user-refreshed';
  process.env.VITE_TERMS_VERSION = '0.0.0-unpublished';
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updateTermsVersionSeenCalls, [{ accountId: 'user-refreshed', version: '0.0.0-unpublished' }]);
});

test('GET with signedIn:false (no session, failed refresh): no sync attempted', async () => {
  readSessionResult = { needsRefresh: true };
  refreshSessionResult = null;
  process.env.VITE_TERMS_VERSION = '0.0.0-unpublished';
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.deepEqual(res.body, { signedIn: false });
  assert.equal(updateTermsVersionSeenCalls.length, 0);
});

test('GET with a sync-time DB failure: swallowed, response is still 200 signedIn:true', async () => {
  process.env.VITE_TERMS_VERSION = '0.0.0-unpublished';
  getTermsVersionSeenShouldThrow = true;
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { signedIn: true, accountId: 'user-abc' });
  assert.equal(updateTermsVersionSeenCalls.length, 0);
});

test('GET with an empty-string VITE_TERMS_VERSION: treated as unset, no sync attempted', async () => {
  process.env.VITE_TERMS_VERSION = '   ';
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(updateTermsVersionSeenCalls.length, 0);
});
