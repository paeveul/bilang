// api/auth/request-code.js — Vercel serverless function. Item 10 Checkpoint
// 2, Step 7.
//
// POST { email } -> 204 (no body) on send, matching plans §10.3's endpoint
// contract. D12: the response is identical whether the address is
// registered, unregistered, or a stranger's mailbox — nothing here branches
// on registration state. shouldCreateUser is always true (sendOtp, in
// api/_lib/auth.js) — there is no separate sign-up flow.

const { sendOtp } = require('../_lib/auth');
const { validateOtpRequest } = require('../_lib/validate');
const { checkRequestCode } = require('../_lib/ratelimit-otp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Second CSRF layer per plans §10.3's Cookies section: SameSite=Lax
  // already withholds the cookie from a cross-site POST, and a cross-site
  // HTML form cannot set this header without triggering a preflight the
  // browser will not permit.
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const validationError = validateOtpRequest(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { email } = req.body;

  // D9: the send limiter increments BEFORE dispatch — an upstream email
  // failure below must still consume the attempt (plans §10.3), which this
  // ordering already guarantees since checkRequestCode() increments as part
  // of deciding the outcome, not after.
  const limitResult = await checkRequestCode(req, email);

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

  try {
    await sendOtp(email);
    res.status(204).end();
  } catch (err) {
    console.error('api/auth/request-code.js error:', err);
    res.status(502).json({
      error: 'We could not send your code. Please try again shortly.',
      code: 'send_failed',
    });
  }
};
