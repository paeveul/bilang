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
const { validateParseRequest } = require('./_lib/validate');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const validationError = validateParseRequest(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { image, mimeType } = req.body;

  try {
    // Claude vision doesn't take a distinct HEIC media type — HEIC photos
    // should already be converted client-side, but fall back to jpeg's media
    // type rather than reject outright if one slips through.
    const effectiveMediaType = mimeType === 'image/heic' ? 'image/jpeg' : mimeType;
    const parsed = await parseReceipt(image, effectiveMediaType);
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
