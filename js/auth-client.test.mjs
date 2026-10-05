// js/auth-client.test.mjs — Item 10 Checkpoint 3, Step 9.
// fetch is stubbed. Nothing here reaches the network, Supabase or email.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  requestCode,
  verifyCode,
  getSession,
  signOut,
  AuthError,
  isSessionExpired,
} from './auth-client.js';
import { SessionExpiredError } from './api-client.js';

const realFetch = globalThis.fetch;
let calls;
let nextResponse;

function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
  nextResponse = () => jsonResponse(200, {});
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return nextResponse();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// --- requestCode ---

test('requestCode: POSTs the email to the versioned request-code route with same-origin credentials', async () => {
  nextResponse = () => new Response(null, { status: 204 });
  const result = await requestCode('someone@example.com');
  assert.equal(result, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/auth/request-code');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'someone@example.com' });
});

test('requestCode: 429 throws AuthError with the server code and retryAfterSeconds kept on the body (nothing displayed)', async () => {
  nextResponse = () =>
    jsonResponse(429, {
      error: 'Too many requests. Wait a moment.',
      code: 'rate_limited',
      retryAfterSeconds: 42,
    });
  await assert.rejects(requestCode('a@b.co'), (err) => {
    assert.ok(err instanceof AuthError);
    assert.equal(err.status, 429);
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.message, 'Too many requests. Wait a moment.');
    assert.equal(err.body.retryAfterSeconds, 42);
    return true;
  });
});

test('requestCode: 503 auth_unavailable surfaces the server code and message unchanged (outage copy stays server-owned)', async () => {
  nextResponse = () =>
    jsonResponse(503, {
      error: 'Sign-in is temporarily unavailable. Please try again shortly.',
      code: 'auth_unavailable',
    });
  await assert.rejects(requestCode('a@b.co'), (err) => {
    assert.equal(err.status, 503);
    assert.equal(err.code, 'auth_unavailable');
    assert.equal(err.message, 'Sign-in is temporarily unavailable. Please try again shortly.');
    return true;
  });
});

test('requestCode: 502 send_failed and 400 validation both reject with their own code', async () => {
  nextResponse = () => jsonResponse(502, { error: 'We could not send your code. Please try again shortly.', code: 'send_failed' });
  await assert.rejects(requestCode('a@b.co'), (err) => err.code === 'send_failed');
  nextResponse = () => jsonResponse(400, { error: 'Enter a valid email address.' });
  await assert.rejects(requestCode('nope'), (err) => err.status === 400 && err.code === null);
});

// --- verifyCode ---

test('verifyCode: sends email, code and terms fields, and returns the accountId', async () => {
  nextResponse = () => jsonResponse(200, { accountId: 'acct-123' });
  const result = await verifyCode('a@b.co', '123456', { termsAccepted: true, termsVersion: 'v-test' });
  assert.deepEqual(result, { accountId: 'acct-123' });
  assert.equal(calls[0].url, '/api/v1/auth/verify-code');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: 'a@b.co',
    code: '123456',
    termsAccepted: true,
    termsVersion: 'v-test',
  });
});

test('verifyCode: a returning user omits the terms fields entirely', async () => {
  nextResponse = () => jsonResponse(200, { accountId: 'acct-1' });
  await verifyCode('a@b.co', '654321');
  assert.deepEqual(JSON.parse(calls[0].init.body), { email: 'a@b.co', code: '654321' });
});

test('verifyCode: the terms version is passed through, never defaulted by this module', async () => {
  nextResponse = () => jsonResponse(200, { accountId: 'acct-1' });
  await verifyCode('a@b.co', '111111', { termsAccepted: true });
  assert.equal('termsVersion' in JSON.parse(calls[0].init.body), false);
});

test('verifyCode: 401 invalid_code and 400 terms_not_accepted reject with their codes', async () => {
  nextResponse = () =>
    jsonResponse(401, { error: 'That code is not valid or has expired. Request a new one.', code: 'invalid_code' });
  await assert.rejects(verifyCode('a@b.co', '000000'), (err) => err.status === 401 && err.code === 'invalid_code');
  nextResponse = () =>
    jsonResponse(400, { error: 'Please accept the Terms and Privacy Notice to continue.', code: 'terms_not_accepted' });
  await assert.rejects(verifyCode('a@b.co', '000000'), (err) => err.code === 'terms_not_accepted');
});

// --- getSession ---

test('getSession: signed in returns the accountId; signed out returns { signedIn: false } without throwing', async () => {
  nextResponse = () => jsonResponse(200, { signedIn: true, accountId: 'acct-9' });
  assert.deepEqual(await getSession(), { signedIn: true, accountId: 'acct-9' });
  assert.equal(calls[0].url, '/api/v1/auth/session');
  assert.equal(calls[0].init.credentials, 'same-origin');

  nextResponse = () => jsonResponse(200, { signedIn: false });
  assert.deepEqual(await getSession(), { signedIn: false });
});

test('getSession: a network failure rejects, so an outage is never mistaken for signed out', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(getSession(), TypeError);
});

test('getSession: a non-200 rejects with AuthError', async () => {
  nextResponse = () => jsonResponse(500, { error: 'Something went wrong.' });
  await assert.rejects(getSession(), (err) => err instanceof AuthError && err.status === 500);
});

// --- signOut ---

test('signOut: DELETEs the session route and resolves on the server 204', async () => {
  nextResponse = () => new Response(null, { status: 204 });
  const result = await signOut();
  assert.equal(result, undefined);
  assert.equal(calls[0].url, '/api/v1/auth/session');
  assert.equal(calls[0].init.method, 'DELETE');
  assert.equal(calls[0].init.credentials, 'same-origin');
});

test('signOut: a non-204 rejects with AuthError', async () => {
  nextResponse = () => jsonResponse(500, { error: 'Could not sign out.' });
  await assert.rejects(signOut(), AuthError);
});

// --- expiry handling ---

test('isSessionExpired: true for a session_expired error from api-client, false for any other error', () => {
  assert.equal(isSessionExpired(new SessionExpiredError('Please sign in to scan a receipt.', {})), true);
  assert.equal(isSessionExpired(new AuthError(401, 'session_expired', {})), true);
  assert.equal(isSessionExpired(new AuthError(503, 'auth_unavailable', {})), false);
  assert.equal(isSessionExpired(new Error('boom')), false);
  assert.equal(isSessionExpired(null), false);
  assert.equal(isSessionExpired(undefined), false);
});

// --- isolation ---

test('every auth call goes only to /api/v1/auth/* and carries no token or Authorization header', async () => {
  nextResponse = () => jsonResponse(200, { signedIn: false });
  await getSession();
  nextResponse = () => new Response(null, { status: 204 });
  await requestCode('a@b.co');
  await signOut();
  nextResponse = () => jsonResponse(200, { accountId: 'x' });
  await verifyCode('a@b.co', '123456');
  assert.equal(calls.length, 4);
  for (const c of calls) {
    assert.ok(c.url.startsWith('/api/v1/auth/'), c.url);
    assert.equal(c.init.headers?.Authorization, undefined);
    assert.equal(c.init.credentials, 'same-origin');
  }
});
