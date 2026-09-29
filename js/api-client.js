// js/api-client.js
//
// Thin fetch wrapper for the two serverless endpoints. Nothing else in the
// client-side app should call fetch() against /api/* directly.
//
// Item 22 Step 3: calls now go through the versioned surface, /api/v1/*,
// which vercel.json rewrites to the unversioned /api/* files (V2 — the
// files under api/ are not renamed, only reached via a different path).
// V1: every endpoint is versioned, including endpoints not built yet.

/**
 * @param {string} base64Image - raw base64 image data (no data: URI prefix)
 * @param {string} mimeType
 * @returns {Promise<object>} parsed receipt: {items, subtotal, service_charge, tax, grand_total}
 */
export async function parseReceipt(base64Image, mimeType) {
  const res = await fetch('/api/v1/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mimeType }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to parse receipt');
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create split');
  }
  return data;
}

/**
 * @param {string} id
 * @returns {Promise<object>} the split's public fields
 */
export async function getSplit(id) {
  const res = await fetch(`/api/v1/split?id=${encodeURIComponent(id)}`);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PatchSplitError(res.status, data.code, data);
  }
  return data;
}
