// api/_lib/validate.js
//
// Basic request validation + short split-ID generation. This is intentionally
// minimal: retry logic, OCR failure/timeout fallback, and oversized-image
// handling beyond a simple size cap are later scope, not built here.

const crypto = require('crypto');
const { nameKey, hasHiddenChars } = require('./name-rule');
const { reconcileReceipt, billDiscountExceedsItems } = require('./totals');

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

// Generate a short, cryptographically random split id, e.g. "K7mP2xQaN".
// Not a security boundary by itself, just a compact, URL-friendly,
// hard-to-guess identifier.
function generateSplitId() {
  const bytes = crypto.randomBytes(ID_LENGTH);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return id;
}

const PAYERS_LIST_INVALID = 'Invalid payers list';
const PAYERS_DUPLICATE = 'Two people have the same name.';
const PAYERS_HIDDEN_CHARS = 'A name has hidden characters. Retype it.';

/**
 * The reason a roster is not acceptable, or null if it is. A roster is a
 * non-empty array of at most MAX_PAYERS names. Each name is 1-20 characters
 * once trimmed, holds no hidden characters, and no two names are the same by
 * the shared rule in ./name-rule (case, extra spaces, full-width and
 * accent variants, hidden characters). Names are checked, never rewritten, so
 * they keep matching the keys the client used in `assignments`.
 */
function payersListError(payers) {
  if (!Array.isArray(payers) || payers.length === 0 || payers.length > MAX_PAYERS) return PAYERS_LIST_INVALID;
  const seen = new Set();
  let duplicate = false;
  for (const name of payers) {
    if (typeof name !== 'string') return PAYERS_LIST_INVALID;
    if (hasHiddenChars(name)) return PAYERS_HIDDEN_CHARS;
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_PAYER_NAME_LEN) return PAYERS_LIST_INVALID;
    const key = nameKey(name);
    if (RESERVED_NAME_KEYS.has(key)) return PAYERS_LIST_INVALID;
    if (seen.has(key)) duplicate = true;
    seen.add(key);
  }
  return duplicate ? PAYERS_DUPLICATE : null;
}

function isValidPayersList(payers) {
  return payersListError(payers) === null;
}

function isReservedNameKey(name) {
  return typeof name === 'string' && RESERVED_NAME_KEYS.has(nameKey(name));
}

/**
 * The roster's own spelling of a name, or null if it is not on the roster.
 * Matching ignores surrounding whitespace and letter case, the same way
 * isValidPayersList decides two names are the same person, so a claim always
 * writes the exact spelling `assignments` and `totals.per_person` already use.
 */
function resolveRosterName(roster, name) {
  if (!Array.isArray(roster) || typeof name !== 'string') return null;
  const key = nameKey(name);
  for (const rosterName of roster) {
    if (typeof rosterName === 'string' && nameKey(rosterName) === key) return rosterName;
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
  const keys = new Set(named.map((n) => nameKey(n)));
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
    // Item discount: optional (an older client sends none), a plain number, never negative.
    if (item.discount !== undefined && (!isFiniteNumber(item.discount) || item.discount < 0)) {
      return 'Invalid item discount';
    }
  }
  if (!body.assignments || typeof body.assignments !== 'object' || Array.isArray(body.assignments)) {
    return 'Missing or invalid assignments';
  }
  if (!body.totals || typeof body.totals !== 'object' || Array.isArray(body.totals)) {
    return 'Missing or invalid totals';
  }
  if (body.totals.discount !== undefined && (!isFiniteNumber(body.totals.discount) || body.totals.discount < 0)) {
    return 'Invalid discount';
  }
  if (body.totals.rounding !== undefined && !isFiniteNumber(body.totals.rounding)) {
    return 'Invalid rounding';
  }
  // Saved with the split so the payer view can say the host set the rounding.
  if (body.totals.rounding_edited !== undefined && typeof body.totals.rounding_edited !== 'boolean') {
    return 'Invalid rounding flag';
  }
  // The host's tick and the stated difference, checked for shape here and for
  // meaning in receiptExactnessError. The server never stores these as sent.
  if (body.totals.receipt_gap_acknowledged !== undefined && typeof body.totals.receipt_gap_acknowledged !== 'boolean') {
    return 'Invalid receipt difference flag';
  }
  if (body.totals.receipt_gap_cents !== undefined && !Number.isInteger(body.totals.receipt_gap_cents)) {
    return 'Invalid receipt difference';
  }
  if (body.payers !== undefined) {
    const payersError = payersListError(body.payers);
    if (payersError) return payersError;
  }
  // merchantName and receiptDate are both genuinely optional (undefined = "no
  // opinion", null = "read but illegible"), round-tripped from whatever
  // api/parse.js returned, same pattern as items/assignments/totals. Only
  // type/shape/length are checked here, same defensive-but-lightweight posture
  // as every other optional field on this request.
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

const RECEIPT_REFUSALS = {
  discount_exceeds_item: 'An item discount is more than the item price.',
  negative_item_line: 'An item price is below zero.',
  bill_discount_exceeds_items: 'The discount is more than the items total.',
  receipt_does_not_add_up: 'The amounts do not add up to the receipt total.',
};

/**
 * The exact receipt check at create time. Run it after validateSplitCreateRequest.
 * Returns null when the split may be created, or `{ code, error }` for the
 * first reason it may not:
 *   discount_exceeds_item / negative_item_line / bill_discount_exceeds_items /
 *   receipt_does_not_add_up
 * A payload with none of the discount fields (an older client) is not checked:
 * it never claimed to follow the exact rule. Cents, no tolerance.
 *
 * The app never writes the difference into rounding or any printed figure. A
 * receipt whose lines do not add up to its printed total is accepted only when
 * the host has ticked that the screen matches the paper
 * (`totals.receipt_gap_acknowledged: true`) AND the stated
 * `totals.receipt_gap_cents` equals the server's own figure. A tick on a
 * receipt that adds up is refused, and so is every impossible figure, ticked
 * or not.
 */
function receiptExactnessError(body) {
  const items = body && body.items;
  const totals = body && body.totals;
  const result = reconcileReceipt(items, totals);
  if (!result.applicable) return null;
  const itemError = result.errors[0];
  let code = null;
  if (itemError) code = itemError.code;
  else if (billDiscountExceedsItems(items, totals)) code = 'bill_discount_exceeds_items';
  else {
    const acknowledged = totals.receipt_gap_acknowledged === true;
    if (result.differenceCents !== 0) {
      if (!acknowledged || totals.receipt_gap_cents !== result.differenceCents) code = 'receipt_does_not_add_up';
    } else if (acknowledged || (totals.receipt_gap_cents !== undefined && totals.receipt_gap_cents !== 0)) {
      code = 'receipt_does_not_add_up';
    }
  }
  return code ? { code, error: RECEIPT_REFUSALS[code] } : null;
}

/**
 * The totals to store: the client's own difference fields are dropped and, when
 * the receipt carries an acknowledged difference, the server stamps both from
 * its own recomputation. Call it after receiptExactnessError has passed. A
 * payload that never claimed the exact rule (an older client) is returned with
 * no marker at all.
 */
function stampReceiptGap(body) {
  const { receipt_gap_cents, receipt_gap_acknowledged, ...rest } = body.totals;
  const result = reconcileReceipt(body.items, body.totals);
  if (!result.applicable || result.differenceCents === 0 || receipt_gap_acknowledged !== true) return rest;
  return { ...rest, receipt_gap_cents: result.differenceCents, receipt_gap_acknowledged: true };
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
    // strict:true cannot bound a number's range, so the discount is checked
    // here. Missing reads as 0 (an older scan); a negative is normalised to
    // positive by normalizeScanDiscounts() before this runs.
    if (item.discount !== undefined && (!isFiniteNumber(item.discount) || item.discount < 0)) {
      return 'Malformed receipt data — invalid item discount';
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
  if (parsed.discount !== undefined && (!isFiniteNumber(parsed.discount) || parsed.discount < 0)) {
    return 'Malformed receipt data — invalid discount';
  }
  if (parsed.rounding !== undefined && !isFiniteNumber(parsed.rounding)) {
    return 'Malformed receipt data — invalid rounding';
  }
  return null;
}

// ---- OTP request/verify validators --------------------------------------

const MAX_EMAIL_LEN = 254; // longest valid email address (RFC 5321)
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_CODE_RE = /^\d{6}$/;

function validateEmailShape(email) {
  if (typeof email !== 'string' || email.length === 0 || email.length > MAX_EMAIL_LEN) {
    return 'Enter a valid email address.';
  }
  if (!EMAIL_SHAPE_RE.test(email.trim())) {
    return 'Enter a valid email address.';
  }
  return null;
}

/**
 * Validate a POST /api/auth/request-code body: `{ email }`. A malformed email
 * is rejected with a 400.
 *
 * @param {*} body
 * @returns {string|null}
 */
function validateOtpRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Enter a valid email address.';
  }
  return validateEmailShape(body.email);
}

/**
 * Validate a POST /api/auth/verify-code body: `{ email, code, termsAccepted,
 * termsVersion }`. Only shape is checked here: email format, code exactly six
 * digits, and (when present) termsAccepted/termsVersion's basic types. Whether
 * termsAccepted/termsVersion are REQUIRED depends on whether the account is
 * being created for the first time, which is only known after the OTP has been
 * verified and the accounts upsert has run; that enforcement lives in
 * api/auth/verify-code.js, not here.
 *
 * @param {*} body
 * @returns {string|null}
 */
function validateOtpVerify(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Enter the 6-digit code from your email.';
  }
  const emailError = validateEmailShape(body.email);
  if (emailError) return 'Enter the 6-digit code from your email.'; // fixed message — never distinguishes email vs code shape
  if (typeof body.code !== 'string' || !OTP_CODE_RE.test(body.code)) {
    return 'Enter the 6-digit code from your email.';
  }
  if (body.termsAccepted !== undefined && typeof body.termsAccepted !== 'boolean') {
    return 'Invalid request.';
  }
  if (body.termsVersion !== undefined) {
    if (typeof body.termsVersion !== 'string' || body.termsVersion.length === 0 || body.termsVersion.length > MAX_STRING_LEN) {
      return 'Invalid request.';
    }
  }
  return null;
}

module.exports = {
  generateSplitId,
  validateParseRequest,
  validateSplitCreateRequest,
  receiptExactnessError,
  stampReceiptGap,
  validateParsedReceipt,
  isValidPayersList,
  payersListError,
  validateClaimRequest,
  resolveRosterName,
  isReservedNameKey,
  validateOtpRequest,
  validateOtpVerify,
  MAX_PAYERS,
  MAX_PAYER_NAME_LEN,
};
