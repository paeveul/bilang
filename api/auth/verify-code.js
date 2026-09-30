// api/auth/verify-code.js — Vercel serverless function. Item 10 Checkpoint
// 2, Step 7.
//
// POST { email, code, termsAccepted, termsVersion } -> 200 { accountId } +
// three Set-Cookie headers, per plans §10.3's endpoint contract.
//
// Order of operations, exactly as specified in §10.3 (this order is
// load-bearing — do not reshuffle it):
//   1. verify-side rate limit (D9 — counts every attempt, including wrong
//      codes)
//   2. verify with Supabase (verifyOtp)
//   3. upsert the accounts row, noting inserted vs matched-existing
//   4. if inserted: require termsAccepted===true + non-empty termsVersion
//      (D15) — on failure, roll back the just-inserted accounts row and
//      refuse with 400 terms_not_accepted, BEFORE any cookie is set
//   5. if inserted: write the terms_acceptances row — on failure, roll back
//      the accounts row and refuse with 500, BEFORE any cookie is set
//   6. issue session cookies; respond 200

const { verifyOtp, issueSessionCookies } = require('../_lib/auth');
const { validateOtpVerify } = require('../_lib/validate');
const { checkVerifyCode } = require('../_lib/ratelimit-otp');
const { upsertAccount, recordTermsAcceptance, deleteOrphanedAccount } = require('../_lib/supabase');

const INVALID_CODE_RESPONSE = { error: 'That code is not valid or has expired. Request a new one.', code: 'invalid_code' };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const validationError = validateOtpVerify(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { email, code, termsAccepted, termsVersion } = req.body;

  const limitResult = await checkVerifyCode(req, email);

  if (limitResult.outcome === 'unavailable') {
    res.status(503).json({
      error: 'Sign-in is temporarily unavailable. Please try again shortly.',
      code: 'auth_unavailable',
    });
    return;
  }

  if (limitResult.outcome === 'limited') {
    res.setHeader('Retry-After', String(limitResult.retryAfterSeconds));
    res.status(429).json({
      error: 'Too many attempts. Please try again later.',
      code: 'rate_limited',
      retryAfterSeconds: limitResult.retryAfterSeconds,
    });
    return;
  }

  let session;
  try {
    session = await verifyOtp(email, code);
  } catch (err) {
    console.error('api/auth/verify-code.js — verifyOtp transport error:', err);
    res.status(401).json(INVALID_CODE_RESPONSE);
    return;
  }
  // Wrong and expired codes both land here (verifyOtp returns null for
  // either) — deliberately not distinguished, per plans §10.3: telling an
  // attacker which one it was tells them whether a code is still live.
  if (!session || !session.user || !session.user.id) {
    res.status(401).json(INVALID_CODE_RESPONSE);
    return;
  }

  const accountId = session.user.id;

  let upsertResult;
  try {
    upsertResult = await upsertAccount(accountId);
  } catch (err) {
    console.error('api/auth/verify-code.js — upsertAccount failed:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }

  if (upsertResult.inserted) {
    const termsOk = termsAccepted === true && typeof termsVersion === 'string' && termsVersion.length > 0;
    if (!termsOk) {
      // D15: an account must never exist with no acceptance record. Roll
      // back the insert this same request just made, before any cookie is
      // set.
      try {
        await deleteOrphanedAccount(accountId);
      } catch (rollbackErr) {
        console.error('api/auth/verify-code.js — rollback of unaccepted-terms account failed:', rollbackErr);
      }
      res.status(400).json({
        error: 'Please accept the Terms and Privacy Notice to continue.',
        code: 'terms_not_accepted',
      });
      return;
    }

    try {
      await recordTermsAcceptance(accountId, termsVersion);
    } catch (err) {
      console.error('api/auth/verify-code.js — recordTermsAcceptance failed:', err);
      try {
        await deleteOrphanedAccount(accountId);
      } catch (rollbackErr) {
        console.error('api/auth/verify-code.js — rollback after failed terms insert failed:', rollbackErr);
      }
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
      return;
    }
  }

  issueSessionCookies(res, session);
  res.status(200).json({ accountId });
};
