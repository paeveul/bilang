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
    if (
      !Array.isArray(body.payers) ||
      body.payers.length === 0 ||
      body.payers.some((name) => typeof name !== 'string' || name.length === 0) ||
      new Set(body.payers).size !== body.payers.length
    ) {
      return 'Invalid payers list';
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
};
