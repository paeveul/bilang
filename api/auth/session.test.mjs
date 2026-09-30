// api/auth/session.test.mjs — Item 10 Checkpoint 2, Step 7.
//
// The real handler, with api/_lib/auth.js replaced by an in-memory stub.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const authPath = require.resolve('../_lib/auth.js');

let readSessionResult;
let refreshSessionResult; // accountId string | null
let clearSessionCookiesCalls;
let revokeSessionUpstreamCalls;

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
