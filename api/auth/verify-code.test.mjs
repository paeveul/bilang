// api/auth/verify-code.test.mjs — Item 10 Checkpoint 2, Step 7.
//
// The real handler, with api/_lib/auth.js, api/_lib/ratelimit-otp.js and
// api/_lib/supabase.js replaced by in-memory stubs.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const authPath = require.resolve('../_lib/auth.js');
const limiterPath = require.resolve('../_lib/ratelimit-otp.js');
const supabasePath = require.resolve('../_lib/supabase.js');

let verifyOtpResult; // session object | null
let verifyOtpThrows;
let issueSessionCookiesCalls;
let limiterResult;
let upsertResult; // {account, inserted}
let upsertThrows;
let recordTermsCalls;
let recordTermsThrows;
let deleteOrphanedCalls;

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    verifyOtp: async () => {
      if (verifyOtpThrows) throw verifyOtpThrows;
      return verifyOtpResult;
    },
    issueSessionCookies: (res, session) => {
      issueSessionCookiesCalls.push(session);
    },
  },
};

require.cache[limiterPath] = {
  id: limiterPath,
  filename: limiterPath,
  loaded: true,
  exports: {
    checkVerifyCode: async () => limiterResult,
  },
};

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    upsertAccount: async () => {
      if (upsertThrows) throw upsertThrows;
      return upsertResult;
    },
    recordTermsAcceptance: async (accountId, termsVersion) => {
      recordTermsCalls.push({ accountId, termsVersion });
      if (recordTermsThrows) throw recordTermsThrows;
    },
    deleteOrphanedAccount: async (id) => {
      deleteOrphanedCalls.push(id);
    },
  },
};

const handler = require('./verify-code.js');

function fakeRes() {
  const headers = {};
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
    end() {},
    setHeader(name, value) {
      headers[name] = value;
    },
    getHeader(name) {
      return headers[name];
    },
    headers,
  };
}

function fakeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { email: 'someone@example.com', code: '123456', termsAccepted: true, termsVersion: '2026-09-23' },
    ...overrides,
  };
}

const VALID_SESSION = {
  access_token: 'AT',
  refresh_token: 'RT',
  user: { id: 'user-abc' },
};

beforeEach(() => {
  verifyOtpResult = VALID_SESSION;
  verifyOtpThrows = null;
  issueSessionCookiesCalls = [];
  limiterResult = { outcome: 'ok' };
  upsertResult = { account: { id: 'user-abc' }, inserted: false }; // default: returning user
  upsertThrows = null;
  recordTermsCalls = [];
  recordTermsThrows = null;
  deleteOrphanedCalls = [];
});

test('non-POST is rejected with 405', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('malformed code shape is rejected with 400 before any verify attempt', async () => {
  const res = fakeRes();
  await handler(fakeReq({ body: { email: 'someone@example.com', code: 'bad' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(issueSessionCookiesCalls.length, 0);
});

test('limiter "unavailable" returns 503 auth_unavailable and never calls verifyOtp', async () => {
  limiterResult = { outcome: 'unavailable' };
  const res = fakeRes();
  let verifyCalled = false;
  const originalVerify = require.cache[authPath].exports.verifyOtp;
  require.cache[authPath].exports.verifyOtp = async () => { verifyCalled = true; return VALID_SESSION; };
  await handler(fakeReq(), res);
  require.cache[authPath].exports.verifyOtp = originalVerify;
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'auth_unavailable');
  assert.equal(verifyCalled, false);
});

test('limiter "limited" returns 429 with Retry-After and code rate_limited', async () => {
  limiterResult = { outcome: 'limited', retryAfterSeconds: 900 };
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'rate_limited');
  assert.equal(res.headers['Retry-After'], '900');
});

test('a wrong/expired code (verifyOtp resolves null) returns 401 invalid_code', async () => {
  verifyOtpResult = null;
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'invalid_code');
  assert.equal(issueSessionCookiesCalls.length, 0);
});

test('a verifyOtp transport failure also returns 401 invalid_code (not a 500)', async () => {
  verifyOtpThrows = new Error('network blip');
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'invalid_code');
});

test('returning user (inserted:false): terms fields are ignored entirely, no terms-acceptance write, session issued', async () => {
  upsertResult = { account: { id: 'user-abc' }, inserted: false };
  const res = fakeRes();
  await handler(fakeReq({ body: { email: 'someone@example.com', code: '123456' } }), res); // no terms fields at all
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { accountId: 'user-abc' });
  assert.equal(recordTermsCalls.length, 0);
  assert.equal(issueSessionCookiesCalls.length, 1);
});

test('new account (inserted:true) with termsAccepted true + termsVersion: records acceptance, issues session, 200', async () => {
  upsertResult = { account: { id: 'user-abc' }, inserted: true };
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { accountId: 'user-abc' });
  assert.deepEqual(recordTermsCalls, [{ accountId: 'user-abc', termsVersion: '2026-09-23' }]);
  assert.equal(issueSessionCookiesCalls.length, 1);
  assert.equal(deleteOrphanedCalls.length, 0);
});

test('D15: new account with termsAccepted false is refused 400 terms_not_accepted, account rolled back, no cookies', async () => {
  upsertResult = { account: { id: 'user-abc' }, inserted: true };
  const res = fakeRes();
  await handler(fakeReq({ body: { email: 'someone@example.com', code: '123456', termsAccepted: false, termsVersion: '2026-09-23' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'terms_not_accepted');
  assert.deepEqual(deleteOrphanedCalls, ['user-abc']);
  assert.equal(recordTermsCalls.length, 0);
  assert.equal(issueSessionCookiesCalls.length, 0);
});

test('D15: new account with termsAccepted omitted entirely is refused 400 terms_not_accepted and rolled back', async () => {
  upsertResult = { account: { id: 'user-abc' }, inserted: true };
  const res = fakeRes();
  await handler(fakeReq({ body: { email: 'someone@example.com', code: '123456' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'terms_not_accepted');
  assert.deepEqual(deleteOrphanedCalls, ['user-abc']);
});

test('an empty-string termsVersion never even reaches D15 logic — validateOtpVerify shape-rejects it first (400, no upsert attempted)', async () => {
  const res = fakeRes();
  await handler(fakeReq({ body: { email: 'someone@example.com', code: '123456', termsAccepted: true, termsVersion: '' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(deleteOrphanedCalls.length, 0); // upsertAccount was never called — nothing to roll back
});

test('D15: new account with termsAccepted true but termsVersion omitted entirely is refused terms_not_accepted and rolled back', async () => {
  upsertResult = { account: { id: 'user-abc' }, inserted: true };
  const res = fakeRes();
  await handler(fakeReq({ body: { email: 'someone@example.com', code: '123456', termsAccepted: true } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'terms_not_accepted');
  assert.deepEqual(deleteOrphanedCalls, ['user-abc']);
});

test('recordTermsAcceptance failure on a new account: rolled back, 500, no cookies set', async () => {
  upsertResult = { account: { id: 'user-abc' }, inserted: true };
  recordTermsThrows = new Error('insert failed');
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(deleteOrphanedCalls, ['user-abc']);
  assert.equal(issueSessionCookiesCalls.length, 0);
});

test('upsertAccount failure: 500, no rollback attempted (nothing was inserted), no cookies', async () => {
  upsertThrows = new Error('db down');
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(deleteOrphanedCalls.length, 0);
  assert.equal(issueSessionCookiesCalls.length, 0);
});
