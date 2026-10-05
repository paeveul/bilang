// api/_lib/auth.js — Item 10 Checkpoint 2, Step 6.
//
// The auth boundary (plans §10.3, "api/_lib/auth.js — the auth boundary").
// This is the ONLY file in the codebase that imports @supabase/supabase-js
// for authentication — mirroring the isolation api/_lib/supabase.js already
// provides for data (plans §10.6 verification #22). Handlers never read
// cookies, never touch tokens, and never call Supabase Auth directly; if a
// handler needs to know who is calling, it calls requireAccount().
//
// D2/D3: the browser never talks to Supabase directly and never sees a
// token. sendOtp/verifyOtp/refreshSession run against Supabase's Auth REST
// API using the ANON key (SUPABASE_ANON_KEY) — "auth calls do not run under
// the service role" (plans §10.3 env-var table). Session identity is
// verified LOCALLY (readSession) against the project's published asymmetric
// JWT signing keys (JWKS) with no network round trip per gated request —
// only sendOtp/verifyOtp/refreshSession are genuine network calls, because
// those operations are inherently server round trips (dispatching an email;
// rotating a refresh token). The JWKS document itself IS fetched over the
// network, but only rarely and cached in memory (JWKS_CACHE_TTL_MS below) —
// this is the standard "local JWT verification" pattern and is what plans
// §10.2 means by "no network call, no added latency" on the hot path.
//
// Verifying locally with no new npm dependency (plans §10.6 verification
// #21) uses Node's built-in `crypto` module: JWK -> KeyObject via
// crypto.createPublicKey({ format: 'jwk' }) (Node >=15.12), and ECDSA
// signature verification via crypto.verify() with `dsaEncoding:
// 'ieee-p1363'`, which accepts a JOSE-style raw r||s signature directly —
// no manual ASN.1/DER conversion needed.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { readCookie, serializeCookie } = require('./cookies');

const COOKIE_AT = 'bilang_at';
const COOKIE_RT = 'bilang_rt';
const COOKIE_SA = 'bilang_sa';

const MAX_AGE_AT = 3600; // 1 hour (D4)
const MAX_AGE_RT = 2592000; // 30 days (D5)
const MAX_AGE_SA = 7776000; // 90 days (D6)

// ---- Supabase clients -----------------------------------------------------
//
// Two separate clients, deliberately: the anon-key client performs the
// user-facing auth operations (OTP send/verify, refresh) exactly as a
// browser client would, per D2. The service-role client is used ONLY for
// the admin-scope operation DELETE /api/auth/session needs (revoking a
// session server-side) — GoTrue's admin API requires the service role,
// there is no anon-key equivalent, and this is the one narrow, necessary
// exception to "auth calls do not run under the service role."

let anonClient = null;
function getAnonAuthClient() {
  if (!anonClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set');
    }
    anonClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return anonClient;
}

let adminClient = null;
function getServiceRoleAuthClient() {
  if (!adminClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
    }
    adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return adminClient;
}

// ---- Local JWT verification -----------------------------------------------

const JWKS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let jwksCache = { keys: [], fetchedAt: 0 };
const publicKeyCache = new Map(); // kid -> KeyObject

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url');
}

function decodeJwtParts(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  let signature;
  try {
    signature = base64UrlDecode(sigB64);
  } catch {
    return null;
  }
  return { header, payload, signingInput: `${headerB64}.${payloadB64}`, signature };
}

async function fetchJwks() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL is not set');
  const response = await fetch(`${url}/auth/v1/.well-known/jwks.json`);
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const body = await response.json();
  return Array.isArray(body.keys) ? body.keys : [];
}

async function getJwks(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache.keys.length > 0 && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  const keys = await fetchJwks();
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

async function getPublicKey(kid) {
  if (publicKeyCache.has(kid)) return publicKeyCache.get(kid);

  let keys = await getJwks();
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // The cached JWKS may be stale (key rotated since last fetch) — refresh
    // once before concluding the key genuinely does not exist.
    keys = await getJwks(true);
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) return null;

  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  publicKeyCache.set(kid, keyObject);
  return keyObject;
}

/**
 * Verify a Supabase access token locally. Returns the decoded payload on a
 * genuinely valid, current, correctly-signed token; returns null for
 * anything else — expired, tampered, malformed, wrong algorithm, unknown
 * key id, or missing required claims. Callers do not need to distinguish
 * WHY a token failed (readSession's contract collapses all of these into
 * the same needsRefresh path — see D7/plans §10.3).
 */
async function verifyAccessToken(token) {
  const decoded = decodeJwtParts(token);
  if (!decoded) return null;
  const { header, payload, signingInput, signature } = decoded;

  // This project issues ES256 only (Step 1's asymmetric-signing-key
  // prerequisite). Refusing any other alg closes the classic "alg
  // confusion" JWT attack outright rather than trusting the token's own
  // header to say what to check it with.
  if (header.alg !== 'ES256') return null;
  if (typeof header.kid !== 'string' || header.kid.length === 0) return null;

  let key;
  try {
    key = await getPublicKey(header.kid);
  } catch {
    // JWKS unreachable — treat as "cannot verify", not "valid". The caller
    // (readSession) will report needsRefresh, and refreshSession will
    // surface a real error if Supabase itself is down.
    return null;
  }
  if (!key) return null;

  let valid;
  try {
    valid = crypto.verify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return null;
  }
  if (!valid) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (payload.aud !== 'authenticated') return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;

  return payload;
}

// ---- Cookie plumbing -------------------------------------------------------

function appendSetCookie(res, cookieString) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', [cookieString]);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieString]);
  } else {
    res.setHeader('Set-Cookie', [existing, cookieString]);
  }
}

/**
 * Write all three session cookies for a brand-new sign-in. A fresh session
 * anchor (bilang_sa) is generated here — this is the ONE place it is ever
 * created; refreshSession() below must never touch it (D6: "set once at
 * sign-in, never re-issued").
 *
 * Not in plans §10.3's auth.js export table verbatim, but required by it:
 * "generate the session anchor; set all three cookies" is listed as part of
 * POST /api/auth/verify-code's own contract. It is implemented here, not in
 * the endpoint handler, so that no handler ever touches a token directly —
 * consistent with this file being the sole token-handling surface.
 *
 * @param {object} res
 * @param {{access_token: string, refresh_token: string}} session
 */
function issueSessionCookies(res, session) {
  const anchor = crypto.randomBytes(32).toString('hex');
  appendSetCookie(res, serializeCookie(COOKIE_AT, session.access_token, MAX_AGE_AT));
  appendSetCookie(res, serializeCookie(COOKIE_RT, session.refresh_token, MAX_AGE_RT));
  appendSetCookie(res, serializeCookie(COOKIE_SA, anchor, MAX_AGE_SA));
}

/**
 * Expire all three session cookies (DELETE /api/auth/session).
 */
function clearSessionCookies(res) {
  appendSetCookie(res, serializeCookie(COOKIE_AT, '', 0));
  appendSetCookie(res, serializeCookie(COOKIE_RT, '', 0));
  appendSetCookie(res, serializeCookie(COOKIE_SA, '', 0));
}

// ---- Public auth operations -------------------------------------------------

/**
 * Send a one-time code to `email`. `shouldCreateUser: true` — there is no
 * separate sign-up flow; first-time sign-in completes in one round trip
 * (plans §10.3). Resolves on success, throws on upstream failure.
 */
async function sendOtp(email) {
  const client = getAnonAuthClient();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/**
 * Tag an upstream error with an `authKind` so the handler can choose the
 * right user-facing response without inspecting Supabase's error shape.
 */
function tagAuthError(error, authKind) {
  const tagged = error instanceof Error ? error : new Error(String(error && error.message ? error.message : error));
  tagged.authKind = authKind;
  return tagged;
}

/**
 * Verify a 6-digit code. Returns the Supabase session object on success
 * ({ access_token, refresh_token, user: { id, ... }, ... }), or null on an
 * invalid/expired code. Throws only on a transport-level failure (D per
 * plans §10.3's auth.js export table).
 */
async function verifyOtp(email, code) {
  const client = getAnonAuthClient();
  const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) {
    // Supabase reports an invalid/expired OTP as an auth-level error with a
    // 4xx status, not a transport failure — treat that as "no session",
    // matching the export table's "null on invalid/expired code" contract.
    // Exception: 429 is Supabase's own rate limit, not a wrong code, so it is
    // thrown tagged `authKind: 'rate_limited'` for the handler to map to 429.
    // Everything else (network failure, 5xx, no status) is thrown tagged
    // `authKind: 'unavailable'` — the handler must not show "invalid code".
    const status = error.status || (error.originalError && error.originalError.status);
    if (status === 429) {
      throw tagAuthError(error, 'rate_limited');
    }
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return null;
    }
    throw tagAuthError(error, 'unavailable');
  }
  if (!data || !data.session) return null;
  return data.session;
}

/**
 * Read `bilang_at` (or, per D14, an `Authorization: Bearer <token>` header
 * when no cookie is present — the cookie takes precedence when both exist)
 * and verify it LOCALLY. Never performs a refresh itself.
 *
 * @param {object} req
 * @returns {Promise<{accountId: string, needsRefresh: false} | {needsRefresh: true}>}
 */
async function readSession(req) {
  let token = readCookie(req, COOKIE_AT);
  if (!token) {
    const authHeader = req.headers && req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice('Bearer '.length).trim();
    }
  }
  if (!token) return { needsRefresh: true };

  const payload = await verifyAccessToken(token);
  if (!payload) return { needsRefresh: true };

  return { accountId: payload.sub, needsRefresh: false };
}

/**
 * Exchange the refresh token for a new session. Requires `bilang_sa`
 * (presence only, per D6 — its value is never checked, only that it has not
 * expired/been cleared) AND `bilang_rt` to be present. Re-issues
 * `bilang_at`/`bilang_rt`; leaves `bilang_sa` completely untouched, which is
 * what makes the 90-day absolute cap non-extending.
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<string|null>} the account id, or null if the session is over.
 */
async function refreshSession(req, res) {
  const anchor = readCookie(req, COOKIE_SA);
  const refreshToken = readCookie(req, COOKIE_RT);
  if (!anchor || !refreshToken) return null;

  const client = getAnonAuthClient();
  let data;
  let error;
  try {
    ({ data, error } = await client.auth.refreshSession({ refresh_token: refreshToken }));
  } catch (err) {
    error = err;
  }
  if (error || !data || !data.session) return null;

  const { session } = data;
  appendSetCookie(res, serializeCookie(COOKIE_AT, session.access_token, MAX_AGE_AT));
  appendSetCookie(res, serializeCookie(COOKIE_RT, session.refresh_token, MAX_AGE_RT));
  // bilang_sa is deliberately NOT re-issued here (D6).

  return session.user ? session.user.id : null;
}

/**
 * readSession, then refreshSession if needed. Returns an accountId, or
 * writes the 401 session_expired response and returns null — callers check
 * for null and return immediately without reaching any body validation
 * (an unauthenticated caller must learn nothing about request shape).
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<string|null>}
 */
async function requireAccount(req, res) {
  const initial = await readSession(req);
  if (!initial.needsRefresh) {
    return initial.accountId;
  }

  const accountId = await refreshSession(req, res);
  if (accountId) return accountId;

  res.status(401).json({ error: 'Please sign in to scan a receipt.', code: 'session_expired' });
  return null;
}

/**
 * Best-effort upstream revoke for DELETE /api/auth/session. Uses the
 * service-role admin API to revoke the session tied to the caller's current
 * access token, if one is present. Failure here must never block a local
 * sign-out (plans §10.3: "Clears cookies even if the upstream revoke
 * fails") — this function swallows its own errors and never throws.
 *
 * Not in plans §10.3's auth.js export table (which predates D14's admin
 * revoke detail); added because DELETE /api/auth/session's own contract
 * requires it and no other module may touch tokens per this file's
 * isolation rule.
 *
 * @param {object} req
 */
async function revokeSessionUpstream(req) {
  const accessToken = readCookie(req, COOKIE_AT);
  if (!accessToken) return;
  try {
    const client = getServiceRoleAuthClient();
    await client.auth.admin.signOut(accessToken, 'global');
  } catch (err) {
    console.error('auth.js: revokeSessionUpstream failed (non-fatal):', err.message);
  }
}

module.exports = {
  sendOtp,
  verifyOtp,
  readSession,
  refreshSession,
  requireAccount,
  clearSessionCookies,
  issueSessionCookies,
  revokeSessionUpstream,
  // Exported for local verification scripts / tests only.
  _internal: { verifyAccessToken, decodeJwtParts },
};
