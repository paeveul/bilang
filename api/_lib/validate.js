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
  }
  if (!body.assignments || typeof body.assignments !== 'object' || Array.isArray(body.assignments)) {
    return 'Missing or invalid assignments';
  }
  if (!body.totals || typeof body.totals !== 'object' || Array.isArray(body.totals)) {
    return 'Missing or invalid totals';
  }
  if (typeof body.ownerPaymentHandle !== 'string' || body.ownerPaymentHandle.trim().length === 0) {
    return "Missing the bill owner's payment details";
  }
  if (body.ownerPaymentHandle.length > MAX_STRING_LEN) {
    return 'Payment details field is too long';
  }
  return null;
}

module.exports = { generateSplitId, validateParseRequest, validateSplitCreateRequest };
