// api/parse.js — Vercel serverless function
//
// POST { image: base64string, mimeType: 'image/jpeg' }
// -> { items, subtotal, service_charge, tax, grand_total }
//
// The receipt image is held in this function's memory for the single Claude
// call only and is NEVER persisted anywhere — no disk, no database, no blob
// storage. This is the core privacy design constraint (roadmap E1): the
// image simply goes out of scope and is garbage-collected once this handler
// returns.
//
// Basic error handling only, per MVP-1 scope. OCR failure/timeout fallback
// and resilience hardening beyond a try/catch are explicit MVP-3 scope
// (roadmap D6) and are not built here.

const { parseReceipt } = require('./_lib/anthropic');
const { validateParseRequest, validateParsedReceipt } = require('./_lib/validate');
const { requireAccount } = require('./_lib/auth');
const { sendBadRequest, hasJsonContentType } = require('./_lib/bad-request');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Item 10 Step 8 (plans §10.3, "Gated endpoints"): the session check runs
  // first after the method check, before body validation, so an unsigned
  // caller learns nothing about request shape and never reaches Claude.
  const accountId = await requireAccount(req, res);
  if (!accountId) return;

  // Content-Type check, after the session check and before body validation.
  // Refused with the generic 400 from api/_lib/bad-request.js. The reason is
  // logged on the server only and is never sent to the client.
  if (!hasJsonContentType(req)) {
    console.warn('api/parse.js refused: request is not application/json');
    sendBadRequest(res);
    return;
  }

  const validationError = validateParseRequest(req.body);
  if (validationError) {
    console.warn('api/parse.js refused:', validationError);
    sendBadRequest(res);
    return;
  }

  const { image, mimeType } = req.body;

  try {
    // Claude vision doesn't take a distinct HEIC media type — HEIC photos
    // should already be converted client-side, but fall back to jpeg's media
    // type rather than reject outright if one slips through.
    const effectiveMediaType = mimeType === 'image/heic' ? 'image/jpeg' : mimeType;
    // Item 17 (17.3): parseReceipt() now also returns `model`/`stopReason` for
    // the harness and server log only — `.parsed` is exactly the object this
    // handler validated and returned before this change. Item 17 Steps 4-5
    // (routing an `unreadable`/degenerate parse to a distinct "unusable"
    // response) are not built yet — wait on Item 13's classifier call site,
    // per the plan's explicit sequencing. Until then this endpoint's
    // behaviour for a bad read is unchanged: it falls through to the same
    // shape-validation rejection below as it did before this change.
    const { parsed } = await parseReceipt(image, effectiveMediaType);

    // Don't rely on Anthropic's `strict: true` as the only control — check
    // the shape ourselves before it leaves this server. See validate.js's
    // validateParsedReceipt() doc comment.
    const shapeError = validateParsedReceipt(parsed);
    if (shapeError) {
      console.error('api/parse.js — model returned malformed shape:', shapeError);
      res.status(502).json({
        error:
          'Could not read this receipt. Try a clearer, better-lit photo, or enter the items manually.',
      });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error('api/parse.js error:', err);
    res.status(500).json({
      error:
        'Could not read this receipt. Try a clearer, better-lit photo, or enter the items manually.',
    });
  }
  // `image` and `mimeType` go out of scope here — nothing written to disk or DB.
};
