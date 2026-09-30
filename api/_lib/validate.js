// api/_lib/validate.js
//
// Basic request validation + short split-ID generation. This is intentionally
// minimal — retry logic, OCR failure/timeout fallback, and oversized-image
// handling beyond a simple size cap are explicit MVP-3 scope (roadmap D6),
// not built here.

const crypto = require('crypto');

const MAX_IMAGE_BASE64_CHARS = 8_000_000; // ~6MB raw image, generous for a phone photo
const MAX_ITEMS = 100;
const MAX_STRING_LEN = 200;
const MAX_PAYER_NAME_LEN = 20;
const MAX_PAYERS = 200;

// Names that collide with Object.prototype keys. They are never valid roster
// names: the roster is used as a lookup key downstream, and `__proto__` in
// particular cannot be stored safely as one. Compared trimmed and lower-cased.
const RESERVED_NAME_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Must match RECEIPT_TOOL's input_schema category enum in api/_lib/anthropic.js
// and the <select> options in js/app.js — three independent copies of the same
// list. If you change one, change all three.
const VALID_CATEGORIES = ['food', 'drink', 'tax', 'service', 'other'];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// Unambiguous alphabet for the public short id: no 0/O, 1/l/I confusion.
const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_LENGTH = 9;

/**
 * Generate a short, cryptographically random split id, e.g. "K7mP2xQaN".
 * Not a security boundary by itself (MVP-1 splits are read-only after
 * creation, per the roadmap's cut list — there is no write path to protect
 * yet), just a compact, URL-friendly, hard-to-guess identifier.
 */
function generateSplitId() {
  const bytes = crypto.randomBytes(ID_LENGTH);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return id;
}

/**
 * A roster is a non-empty array of at most MAX_PAYERS names. Each name is 1-20
 * characters once trimmed, and no two names match case-insensitively (after
 * trimming). Names are checked, never rewritten, so they keep matching the
 * keys the client used in `assignments`.
 */
function isValidPayersList(payers) {
  if (!Array.isArray(payers) || payers.length === 0 || payers.length > MAX_PAYERS) return false;
  const seen = new Set();
  for (const name of payers) {
    if (typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PAYER_NAME_LEN) return false;
    const key = trimmed.toLowerCase();
    if (RESERVED_NAME_KEYS.has(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function isReservedNameKey(name) {
  return typeof name === 'string' && RESERVED_NAME_KEYS.has(name.trim().toLowerCase());
}

/**
 * The roster's own spelling of a name, or null if it is not on the roster.
 * Matching ignores surrounding whitespace and letter case, the same way
 * isValidPayersList decides two names are the same person, so a claim always
 * writes the exact spelling `assignments` and `totals.per_person` already use.
 */
function resolveRosterName(roster, name) {
  if (!Array.isArray(roster) || typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  for (const rosterName of roster) {
    if (typeof rosterName === 'string' && rosterName.trim().toLowerCase() === key) return rosterName;
  }
  return null;
}

const CLAIM_ACTIONS = ['claim', 'unclaim'];
const CLAIM_FIELDS = ['action', 'itemId', 'payer', 'sharedWith'];
const MAX_CLAIM_BODY_CHARS = 16_384;

/**
 * Validate a PATCH /api/split claim body. Returns an error message, or null
 * if the body is acceptable. Pure: no I/O.
 *
 * The write is one item wide: exactly the fields action, itemId, payer and
 * (for `claim` only) sharedWith. Anything else, including `items`, `totals`
 * or a whole `assignments`, is rejected.
 *
 * Call it without `split` to check the body's shape only (before the split
 * has been read), and with the loaded `split` to also check the names against
 * the stored roster and the item id against the split's items. Callers must
 * already have handled a split with no roster (that is a 409, not a 400).
 *
 * @param {*} body
 * @param {{items?: Array<{id: string}>, payers?: string[]}|null} [split]
 * @returns {string|null}
 */
function validateClaimRequest(body, split = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Invalid request body';
  }
  if (JSON.stringify(body).length > MAX_CLAIM_BODY_CHARS) {
    return 'Request body is too large';
  }
  for (const key of Object.keys(body)) {
    if (!CLAIM_FIELDS.includes(key)) return 'Unknown field in request'; // fixed text: never echo the caller's field name
  }
  if (!CLAIM_ACTIONS.includes(body.action)) {
    return 'Invalid action';
  }
  if (typeof body.itemId !== 'string' || body.itemId.length === 0 || body.itemId.length > MAX_STRING_LEN) {
    return 'Invalid itemId';
  }
  if (!isClaimName(body.payer)) {
    return 'Invalid payer name';
  }
  if (body.sharedWith !== undefined) {
    if (body.action !== 'claim') return 'sharedWith applies to claim only';
    if (!Array.isArray(body.sharedWith) || body.sharedWith.length >= MAX_PAYERS) {
      return 'Invalid sharedWith list';
    }
    if (!body.sharedWith.every(isClaimName)) return 'Invalid name in sharedWith';
  }

  const named = [body.payer, ...(body.sharedWith || [])];
  const keys = new Set(named.map((n) => n.trim().toLowerCase()));
  if (keys.size !== named.length) {
    return 'Duplicate names in claim';
  }

  if (split) {
    if (!Array.isArray(split.items) || !split.items.some((item) => item && item.id === body.itemId)) {
      return 'Unknown itemId';
    }
    if (named.some((n) => resolveRosterName(split.payers, n) === null)) {
      return 'Name is not on this split';
    }
  }
  return null;
}

// A claim name follows the roster rule: 1-20 characters once trimmed.
function isClaimName(name) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_PAYER_NAME_LEN;
}

function validateParseRequest(body) {
  if (!body || typeof body.image !== 'string' || body.image.length === 0) {
    return 'Missing image data';
  }
  if (body.image.length > MAX_IMAGE_BASE64_CHARS) {
    return 'Image too large — please retake the photo at a lower resolution';
  }
  if (typeof body.mimeType !== 'string' || !/^image\/(jpeg|png|webp|heic)$/.test(body.mimeType)) {
    return 'Unsupported or missing image type';
  }
  return null;
}

function validateSplitCreateRequest(body) {
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return 'Split must include at least one item';
  }
  if (body.items.length > MAX_ITEMS) {
    return 'Too many items on this split';
  }
  for (const item of body.items) {
    if (
      typeof item.name !== 'string' ||
      item.name.length === 0 ||
      item.name.length > MAX_STRING_LEN
    ) {
      return 'Invalid item name';
    }
    if (typeof item.line_total !== 'number' || !Number.isFinite(item.line_total)) {
      return 'Invalid item line_total';
    }
    if (!isFiniteNumber(item.qty) || item.qty <= 0) {
      return 'Invalid item quantity';
    }
    if (!isFiniteNumber(item.unit_price) || item.unit_price < 0) {
      return 'Invalid item unit price';
    }
    if (typeof item.category !== 'string' || !VALID_CATEGORIES.includes(item.category)) {
      return 'Invalid item category';
    }
  }
  if (!body.assignments || typeof body.assignments !== 'object' || Array.isArray(body.assignments)) {
    return 'Missing or invalid assignments';
  }
  if (!body.totals || typeof body.totals !== 'object' || Array.isArray(body.totals)) {
    return 'Missing or invalid totals';
  }
  if (body.payers !== undefined) {
    if (!isValidPayersList(body.payers)) {
      return 'Invalid payers list';
    }
  }
  // Item 23, D4/D6: both genuinely optional (undefined = "no opinion",
  // null = "read but illegible") — round-tripped from whatever
  // api/parse.js returned, same pattern as items/assignments/totals. Only
  // type/shape/length are checked here, same defensive-but-lightweight
  // posture as every other optional field on this request.
  if (body.merchantName !== undefined && body.merchantName !== null) {
    if (typeof body.merchantName !== 'string' || body.merchantName.length > MAX_STRING_LEN) {
      return 'Invalid merchant name';
    }
  }
  if (body.receiptDate !== undefined && body.receiptDate !== null) {
    if (typeof body.receiptDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.receiptDate)) {
      return 'Invalid receipt date';
    }
  }
  if (typeof body.ownerPaymentHandle !== 'string' || body.ownerPaymentHandle.trim().length === 0) {
    return "Missing the bill owner's payment details";
  }
  if (body.ownerPaymentHandle.length > MAX_STRING_LEN) {
    return 'Payment details field is too long';
  }
  return null;
}

/**
 * Shape-validate Claude's tool-call output before it leaves this server.
 *
 * `strict: true` on RECEIPT_TOOL (api/_lib/anthropic.js) makes Anthropic
 * enforce the schema on the model's side, but that is an external service's
 * guarantee, not Bilang's own. This is the same three-line check the client
 * would otherwise be trusting `toolUse.input` to have satisfied — done here
 * so a malformed or unexpected response never reaches the browser, whatever
 * caused it (a future prompt/schema edit, a model-provider change, etc.).
 */
function validateParsedReceipt(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'Malformed receipt data';
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    return 'Malformed receipt data — no items';
  }
  if (parsed.items.length > MAX_ITEMS) {
    return 'Malformed receipt data — too many items';
  }
  for (const item of parsed.items) {
    if (!item || typeof item !== 'object') {
      return 'Malformed receipt data — invalid item';
    }
    if (typeof item.name !== 'string' || item.name.length === 0 || item.name.length > MAX_STRING_LEN) {
      return 'Malformed receipt data — invalid item name';
    }
    if (typeof item.category !== 'string' || !VALID_CATEGORIES.includes(item.category)) {
      return 'Malformed receipt data — invalid item category';
    }
    if (!isFiniteNumber(item.qty) || item.qty <= 0) {
      return 'Malformed receipt data — invalid item quantity';
    }
    if (!isFiniteNumber(item.unit_price) || item.unit_price < 0) {
      return 'Malformed receipt data — invalid item unit price';
    }
    if (!isFiniteNumber(item.line_total)) {
      return 'Malformed receipt data — invalid item line total';
    }
  }
  if (
    !isFiniteNumber(parsed.subtotal) ||
    !isFiniteNumber(parsed.service_charge) ||
    !isFiniteNumber(parsed.tax) ||
    !isFiniteNumber(parsed.grand_total)
  ) {
    return 'Malformed receipt data — invalid totals';
  }
  return null;
}

module.exports = {
  generateSplitId,
  validateParseRequest,
  validateSplitCreateRequest,
  validateParsedReceipt,
  isValidPayersList,
  validateClaimRequest,
  resolveRosterName,
  isReservedNameKey,
  MAX_PAYERS,
  MAX_PAYER_NAME_LEN,
};
