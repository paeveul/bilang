//
//
//
// Error handling: every non-success response is thrown as an AuthError
// carrying the HTTP status, the response body's `code`, and the body itself.
// The message is the server's own `error` string, unchanged, so the outage
// and rate-limit copy stays owned by the server. Retry-After is exposed as
// `body.retryAfterSeconds` for callers that want it; this module displays nothing.
//

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
