// api/auth/request-code.test.mjs — Item 10 Checkpoint 2, Step 7.
//
// The real handler, with api/_lib/auth.js and api/_lib/ratelimit-otp.js
// replaced by in-memory stubs — same "stub the data-access layer, run the
// real handler" pattern api/split.post.test.mjs already uses.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const authPath = require.resolve('../_lib/auth.js');
const limiterPath = require.resolve('../_lib/ratelimit-otp.js');

let sendOtpCalls;
let sendOtpBehavior; // () => void | throws
let limiterResult;

require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    sendOtp: async (email) => {
      sendOtpCalls.push(email);
      if (sendOtpBehavior) sendOtpBehavior();
    },
  },
};

require.cache[limiterPath] = {
  id: limiterPath,
  filename: limiterPath,
  loaded: true,
  exports: {
    checkRequestCode: async () => limiterResult,
  },
};

const handler = require('./request-code.js');

function fakeRes() {
  const headers = {};
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
    body: { email: 'someone@example.com' },
    ...overrides,
  };
}

beforeEach(() => {
  sendOtpCalls = [];
  sendOtpBehavior = null;
  limiterResult = { outcome: 'ok' };
});

test('non-POST is rejected with 405', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('a non-JSON content-type is rejected with 400 (CSRF second layer)', async () => {
  const res = fakeRes();
  await handler(fakeReq({ headers: {} }), res);
  assert.equal(res.statusCode, 400);
});

test('a malformed email is rejected with 400 before the limiter or sendOtp run', async () => {
  const res = fakeRes();
  await handler(fakeReq({ body: { email: 'not-an-email' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(sendOtpCalls.length, 0);
});

test('a valid email sends the code and returns 204 with no body', async () => {
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.body, null);
  assert.deepEqual(sendOtpCalls, ['someone@example.com']);
});

test('limiter outcome "unavailable" returns 503 auth_unavailable and never calls sendOtp', async () => {
  limiterResult = { outcome: 'unavailable' };
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'auth_unavailable');
  assert.equal(sendOtpCalls.length, 0);
});

test('limiter outcome "limited" returns 429 with Retry-After header and code rate_limited', async () => {
  limiterResult = { outcome: 'limited', retryAfterSeconds: 42 };
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'rate_limited');
  assert.equal(res.body.retryAfterSeconds, 42);
  assert.equal(res.headers['Retry-After'], '42');
  assert.equal(sendOtpCalls.length, 0);
});

test('an upstream sendOtp failure (attempt already consumed by the limiter) returns 502 send_failed', async () => {
  sendOtpBehavior = () => {
    throw new Error('SMTP relay unreachable');
  };
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'send_failed');
  assert.deepEqual(sendOtpCalls, ['someone@example.com']); // the attempt WAS made/consumed
});
