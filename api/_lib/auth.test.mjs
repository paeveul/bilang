// api/_lib/auth.test.mjs — Item 10 Checkpoint 2, Step 6.
//
// Exercises the LOCAL JWT verification path (readSession / verifyAccessToken)
// against a self-generated EC P-256 keypair standing in for Supabase's real
// project signing key, with global.fetch mocked to serve that key's public
// half as the project's JWKS document. No real Supabase project is reached
// by this file — the real-inbox / real-session round trip (sendOtp,
// verifyOtp, refreshSession against the live project) is exercised
// separately per the Checkpoint 2 handback report, not here.
//
// Run: node --test api/_lib/auth.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);

const originalFetch = global.fetch;
const originalUrl = process.env.SUPABASE_URL;
const originalAnonKey = process.env.SUPABASE_ANON_KEY;
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_KID = 'test-key-1';
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicJwk = publicKey.export({ format: 'jwk' });
publicJwk.kid = TEST_KID;
publicJwk.alg = 'ES256';
publicJwk.use = 'sig';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Mint a real ES256 JWT signed by our own test keypair, in the same shape
 * readSession expects: header.kid matches the mocked JWKS, payload carries
 * sub/aud/exp.
 */
function signTestJwt(payload, { kid = TEST_KID, alg = 'ES256' } = {}) {
  const header = { alg, typ: 'JWT', kid };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${signature.toString('base64url')}`;
}

function installMockJwks() {
  global.fetch = async (url) => {
    if (String(url).includes('/.well-known/jwks.json')) {
      return { ok: true, json: async () => ({ keys: [publicJwk] }) };
    }
    throw new Error(`unexpected mock fetch: ${url}`);
  };
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://mock-project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'mock-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';
  installMockJwks();
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalAnonKey;
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
});

function freshModule() {
  const modPath = require.resolve('./auth.js');
  delete require.cache[modPath];
  return require('./auth.js');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function fakeReqWithCookie(name, value) {
  return { headers: { cookie: `${name}=${encodeURIComponent(value)}` } };
}

test('readSession: accepts a fresh, correctly-signed token and returns its accountId', async () => {
  const { readSession } = freshModule();
  const token = signTestJwt({ sub: 'user-123', aud: 'authenticated', exp: nowSeconds() + 3600 });
  const result = await readSession(fakeReqWithCookie('bilang_at', token));
  assert.deepEqual(result, { accountId: 'user-123', needsRefresh: false });
});

test('readSession: rejects a tampered token (payload altered after signing)', async () => {
  const { readSession } = freshModule();
  const token = signTestJwt({ sub: 'user-123', aud: 'authenticated', exp: nowSeconds() + 3600 });
  const [h, p, s] = token.split('.');
  const tamperedPayload = base64url(JSON.stringify({ sub: 'attacker-999', aud: 'authenticated', exp: nowSeconds() + 3600 }));
  const tampered = `${h}.${tamperedPayload}.${s}`;
  const result = await readSession(fakeReqWithCookie('bilang_at', tampered));
  assert.deepEqual(result, { needsRefresh: true });
});

test('readSession: rejects a token signed by a key not in the JWKS (wrong signer)', async () => {
  const { readSession } = freshModule();
  const otherKeypair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const header = { alg: 'ES256', typ: 'JWT', kid: TEST_KID }; // claims to be our known kid...
  const payload = { sub: 'user-123', aud: 'authenticated', exp: nowSeconds() + 3600 };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  // ...but is actually signed with a DIFFERENT private key.
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: otherKeypair.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const forged = `${signingInput}.${signature.toString('base64url')}`;
  const result = await readSession(fakeReqWithCookie('bilang_at', forged));
  assert.deepEqual(result, { needsRefresh: true });
});

test('readSession: reports needsRefresh for an expired token', async () => {
  const { readSession } = freshModule();
  const token = signTestJwt({ sub: 'user-123', aud: 'authenticated', exp: nowSeconds() - 10 });
  const result = await readSession(fakeReqWithCookie('bilang_at', token));
  assert.deepEqual(result, { needsRefresh: true });
});

test('readSession: reports needsRefresh when no cookie and no Authorization header are present', async () => {
  const { readSession } = freshModule();
  const result = await readSession({ headers: {} });
  assert.deepEqual(result, { needsRefresh: true });
});

test('readSession: rejects an unsupported algorithm even if otherwise well-formed (alg-confusion guard)', async () => {
  const { readSession } = freshModule();
  const token = signTestJwt({ sub: 'user-123', aud: 'authenticated', exp: nowSeconds() + 3600 }, { alg: 'HS256' });
  const result = await readSession(fakeReqWithCookie('bilang_at', token));
  assert.deepEqual(result, { needsRefresh: true });
});

test('readSession: rejects a token missing the required aud claim', async () => {
  const { readSession } = freshModule();
  const token = signTestJwt({ sub: 'user-123', exp: nowSeconds() + 3600 });
  const result = await readSession(fakeReqWithCookie('bilang_at', token));
  assert.deepEqual(result, { needsRefresh: true });
});

// ---- D14: bearer-token transport ------------------------------------------

test('readSession: D14 — accepts a token via Authorization: Bearer header when no cookie is present', async () => {
  const { readSession } = freshModule();
  const token = signTestJwt({ sub: 'user-mobile', aud: 'authenticated', exp: nowSeconds() + 3600 });
  const result = await readSession({ headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(result, { accountId: 'user-mobile', needsRefresh: false });
});

test('readSession: D14 — the cookie takes precedence when both cookie and header are present', async () => {
  const { readSession } = freshModule();
  const cookieToken = signTestJwt({ sub: 'from-cookie', aud: 'authenticated', exp: nowSeconds() + 3600 });
  const headerToken = signTestJwt({ sub: 'from-header', aud: 'authenticated', exp: nowSeconds() + 3600 });
  const req = {
    headers: {
      cookie: `bilang_at=${cookieToken}`,
      authorization: `Bearer ${headerToken}`,
    },
  };
  const result = await readSession(req);
  assert.equal(result.accountId, 'from-cookie');
});

// ---- requireAccount / clearSessionCookies / issueSessionCookies ----------

test('requireAccount: returns the accountId for a valid session without writing any response', async () => {
  const { requireAccount } = freshModule();
  const token = signTestJwt({ sub: 'user-abc', aud: 'authenticated', exp: nowSeconds() + 3600 });
  let statusCalled = false;
  const res = { status: () => { statusCalled = true; return { json() {} }; } };
  const accountId = await requireAccount(fakeReqWithCookie('bilang_at', token), res);
  assert.equal(accountId, 'user-abc');
  assert.equal(statusCalled, false);
});

test('requireAccount: with no cookies at all and a refresh attempt that cannot proceed, writes 401 session_expired', async () => {
  const { requireAccount } = freshModule();
  let statusCode;
  let jsonBody;
  const res = {
    status(code) {
      statusCode = code;
      return { json: (body) => { jsonBody = body; } };
    },
  };
  const accountId = await requireAccount({ headers: {} }, res);
  assert.equal(accountId, null);
  assert.equal(statusCode, 401);
  assert.deepEqual(jsonBody, { error: 'Please sign in to scan a receipt.', code: 'session_expired' });
});

// verifyOtp error classification. Supabase's /auth/v1/verify endpoint is
// mocked at global.fetch — nothing reaches a real Supabase project or sends
// any email.
function mockVerifyResponse({ status, body }) {
  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/verify')) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected mock fetch: ${url}`);
  };
}

test('verifyOtp: a Supabase 4xx wrong/expired code resolves null (unchanged 401 path in the handler)', async () => {
  mockVerifyResponse({ status: 403, body: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } });
  const { verifyOtp } = freshModule();
  const session = await verifyOtp('someone@example.com', '123456');
  assert.equal(session, null);
});

test('verifyOtp: a Supabase 5xx is thrown tagged authKind "unavailable" (never resolves null)', async () => {
  mockVerifyResponse({ status: 500, body: { code: 500, msg: 'Internal error' } });
  const { verifyOtp } = freshModule();
  await assert.rejects(verifyOtp('someone@example.com', '123456'), (err) => {
    assert.equal(err.authKind, 'unavailable');
    return true;
  });
});

test('verifyOtp: a Supabase 429 is thrown tagged authKind "rate_limited" (not treated as a wrong code)', async () => {
  mockVerifyResponse({ status: 429, body: { code: 429, msg: 'Too many requests' } });
  const { verifyOtp } = freshModule();
  await assert.rejects(verifyOtp('someone@example.com', '123456'), (err) => {
    assert.equal(err.authKind, 'rate_limited');
    return true;
  });
});

test('verifyOtp: a network failure (fetch rejects) is thrown tagged authKind "unavailable"', async () => {
  global.fetch = async (url) => {
    if (String(url).includes('/auth/v1/verify')) throw new TypeError('fetch failed');
    if (String(url).includes('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected mock fetch: ${url}`);
  };
  const { verifyOtp } = freshModule();
  await assert.rejects(verifyOtp('someone@example.com', '123456'), (err) => {
    assert.equal(err.authKind, 'unavailable');
    return true;
  });
});

test('issueSessionCookies: writes three Set-Cookie headers with the correct names and Max-Age values', () => {
  const { issueSessionCookies } = freshModule();
  const headers = {};
  const res = {
    getHeader: (name) => headers[name],
    setHeader: (name, value) => { headers[name] = value; },
  };
  issueSessionCookies(res, { access_token: 'AT', refresh_token: 'RT' });
  const setCookies = headers['Set-Cookie'];
  assert.equal(setCookies.length, 3);
  assert.ok(setCookies.some((c) => c.startsWith('bilang_at=AT') && c.includes('Max-Age=3600')));
  assert.ok(setCookies.some((c) => c.startsWith('bilang_rt=RT') && c.includes('Max-Age=2592000')));
  assert.ok(setCookies.some((c) => c.startsWith('bilang_sa=') && c.includes('Max-Age=7776000')));
  const anchorCookie = setCookies.find((c) => c.startsWith('bilang_sa='));
  const anchorValue = decodeURIComponent(anchorCookie.split(';')[0].split('=')[1]);
  assert.equal(anchorValue.length, 64); // 32 random bytes, hex-encoded
});

test('clearSessionCookies: writes three Set-Cookie headers all with Max-Age=0', () => {
  const { clearSessionCookies } = freshModule();
  const headers = {};
  const res = {
    getHeader: (name) => headers[name],
    setHeader: (name, value) => { headers[name] = value; },
  };
  clearSessionCookies(res);
  const setCookies = headers['Set-Cookie'];
  assert.equal(setCookies.length, 3);
  for (const c of setCookies) {
    assert.match(c, /Max-Age=0/);
  }
  assert.ok(setCookies.some((c) => c.startsWith('bilang_at=')));
  assert.ok(setCookies.some((c) => c.startsWith('bilang_rt=')));
  assert.ok(setCookies.some((c) => c.startsWith('bilang_sa=')));
});
