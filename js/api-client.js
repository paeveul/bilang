// js/api-client.js
//
// Thin fetch wrapper for the two serverless endpoints. Nothing else in the
// client-side app should call fetch() against /api/* directly.
//

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
