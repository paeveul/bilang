// api/parse.js — Vercel serverless function
//
// POST { image: base64string, mimeType: 'image/jpeg' }
// -> { items, subtotal, service_charge, tax, grand_total }
//
//

const { parseReceipt } = require('./_lib/anthropic');
const { normalizeScanDiscounts } = require('./_lib/totals');
const { validateParseRequest, validateParsedReceipt } = require('./_lib/validate');
const { requireAccount } = require('./_lib/auth');
const { sendBadRequest, hasJsonContentType } = require('./_lib/bad-request');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

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
    res.status(400).json({ error: validationError });
    return;
  }

  const { image, mimeType } = req.body;

  try {
    // Claude vision doesn't take a distinct HEIC media type — HEIC photos
    // should already be converted client-side, but fall back to jpeg's media
    // type rather than reject outright if one slips through.
    const effectiveMediaType = mimeType === 'image/heic' ? 'image/jpeg' : mimeType;
    const { parsed: rawParsed } = await parseReceipt(image, effectiveMediaType);
    // Missing discount / rounding read as 0; a printed negative discount is
    // stored positive. Nothing is invented. See normalizeScanDiscounts().
    const parsed = normalizeScanDiscounts(rawParsed);

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
