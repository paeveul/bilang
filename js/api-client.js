// js/api-client.js
//
// Thin fetch wrapper for the two serverless endpoints. Nothing else in the
// client-side app should call fetch() against /api/* directly.
//
// Item 22 Step 3: calls now go through the versioned surface, /api/v1/*,
// which vercel.json rewrites to the unversioned /api/* files (V2 — the
// files under api/ are not renamed, only reached via a different path).
// V1: every endpoint is versioned, including endpoints not built yet.

// Item 10 Step 9 (plans §10.3, "js/api-client.js — modified"): a response
// carrying code "session_expired" is thrown as a SessionExpiredError, so
// callers can branch on it (the in-place re-auth of Step 11) without matching
// message text. The message is still the server's own error string.
export class SessionExpiredError extends Error {
  constructor(message, body) {
    super(message);
    this.name = 'SessionExpiredError';
    this.code = 'session_expired';
    this.body = body;
  }
}

function failureFor(data, fallbackMessage) {
  const message = data.error || fallbackMessage;
  if (data.code === 'session_expired') return new SessionExpiredError(message, data);
  return new Error(message);
}

/**
 * @param {string} base64Image - raw base64 image data (no data: URI prefix)
 * @param {string} mimeType
 * @returns {Promise<object>} parsed receipt: {items, subtotal, service_charge, tax, grand_total}
 */
export async function parseReceipt(base64Image, mimeType) {
  const res = await fetch('/api/v1/parse', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mimeType }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw failureFor(data, 'Failed to parse receipt');
  }
  return data;
}

/**
 * @param {object} payload - {items, assignments, totals, payers, ownerPaymentHandle}
 * @returns {Promise<{id: string, url: string}>}
 */
export async function createSplit(payload) {
  const res = await fetch('/api/v1/split', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw failureFor(data, 'Failed to create split');
  }
  return data;
}

/**
 * @param {string} id
 * @returns {Promise<object>} the split's public fields
 */
export async function getSplit(id) {
  const res = await fetch(`/api/v1/split?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Split not found');
  }
  return data;
}

/**
 * Item 24 Step 7 — claim or un-claim one item. Same endpoint as getSplit(),
 * a different HTTP method (PATCH /api/v1/split?id=<id>), per api/split.js's
 * handler. Unlike parseReceipt/createSplit/getSplit above, this can fail
 * with a meaningful, expected non-200 (409 already_claimed / 403
 * not_your_claim / 429 / 503 / 409 claiming_unavailable per Item 24
 * §24.3's response table) that the caller needs to branch on by more than
 * just a message string — so this throws a PatchSplitError carrying the
 * HTTP status and the response body's `code`, rather than only a message.
 *
 * @param {string} id
 * @param {{action:'claim'|'unclaim', itemId:string, payer:string, sharedWith?:string[]}} body
 * @returns {Promise<{assignments:object, totals:object, version:number}>}
 */
export class PatchSplitError extends Error {
  constructor(status, code, body) {
    super(body?.error || code || `Request failed (${status})`);
    this.status = status;
    this.code = code || null;
    this.body = body;
  }
}

export async function patchSplit(id, body) {
  const res = await fetch(`/api/v1/split?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PatchSplitError(res.status, data.code, data);
  }
  return data;
}
