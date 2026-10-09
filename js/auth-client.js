// js/auth-client.js — Item 10 Checkpoint 3, Step 9.
//
// Browser-side wrapper for the four auth endpoints (plans §10.3, "js/auth-client.js").
// Mirrors js/api-client.js: the only module that calls /api/v1/auth/*.
//
// The browser never talks to Supabase and never sees a token (D2/D3). The
// session lives in HttpOnly cookies that the server sets and reads, so every
// request sends `credentials: 'same-origin'` and this module never touches
// document.cookie, localStorage or an Authorization header.
//
// Error handling: every non-success response is thrown as an AuthError
// carrying the HTTP status, the response body's `code`, and the body itself.
// The message is the server's own `error` string, unchanged, so the outage
// and rate-limit copy stays owned by the server. Retry-After is exposed as
// `body.retryAfterSeconds` for callers that want it; this module displays nothing.
//
// Versioned surface: /api/v1/* is rewritten to /api/* by vercel.json (Item 22
// Step 3), so these calls land on api/auth/*.js.

const AUTH_BASE = '/api/v1/auth';

export class AuthError extends Error {
  constructor(status, code, body) {
    super(body?.error || code || `Request failed (${status})`);
    this.name = 'AuthError';
    this.status = status;
    this.code = code || null;
    this.body = body ?? null;
  }
}

/**
 * True when an error from any api-client or auth-client call means the
 * session is over. Callers use this to choose the in-place re-auth path
 * (Step 11) instead of the error screen.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isSessionExpired(err) {
  return Boolean(err) && err.code === 'session_expired';
}

async function readBody(res) {
  // 204 responses have no body; a malformed body is treated as no body.
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function call(path, init) {
  const res = await fetch(`${AUTH_BASE}${path}`, { credentials: 'same-origin', ...init });
  const body = await readBody(res);
  if (!res.ok) {
    throw new AuthError(res.status, body?.code, body);
  }
  return body;
}

/**
 * Ask the server to email a six-digit code. Resolves on the server's 204,
 * which is identical for known, unknown and rate-limited-but-valid addresses
 * (D12). Throws AuthError on 400, 429, 502 and 503 — including 400
 * terms_not_accepted (Alex, 2026-10-10): the tick now gates the SEND itself,
 * not just verification, so the server refuses before dispatch when the tick
 * fields are missing or false.
 *
 * @param {string} email
 * @param {{termsAccepted?: boolean, termsVersion?: string}} [terms]
 * @returns {Promise<void>}
 */
export async function requestCode(email, terms = {}) {
  await call('/request-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      ...(terms.termsAccepted === undefined ? {} : { termsAccepted: terms.termsAccepted }),
      ...(terms.termsVersion === undefined ? {} : { termsVersion: terms.termsVersion }),
    }),
  });
}

/**
 * Verify the code. On first-time account creation the server requires the
 * terms-acceptance fields (D15); a returning user omits them. The terms
 * version is supplied by the caller and is never hardcoded here.
 *
 * @param {string} email
 * @param {string} code - exactly six digits
 * @param {{termsAccepted?: boolean, termsVersion?: string}} [terms]
 * @returns {Promise<{accountId: string}>}
 */
export async function verifyCode(email, code, terms = {}) {
  return call('/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      code,
      ...(terms.termsAccepted === undefined ? {} : { termsAccepted: terms.termsAccepted }),
      ...(terms.termsVersion === undefined ? {} : { termsVersion: terms.termsVersion }),
    }),
  });
}

/**
 * Check the session on app load. The server runs its refresh path, so opening
 * the app extends a rolling session. An expired session is a normal answer
 * ({ signedIn: false }), not an error. A network failure or a non-200 rejects,
 * so the caller never mistakes an outage for a signed-out user.
 *
 * @returns {Promise<{signedIn: true, accountId: string} | {signedIn: false}>}
 */
export async function getSession() {
  return call('/session', { method: 'GET' });
}

/**
 * Sign out. The server clears the cookies even if its upstream revoke fails,
 * so this resolves on the server's 204.
 *
 * @returns {Promise<void>}
 */
export async function signOut() {
  await call('/session', { method: 'DELETE' });
}
