// api/_lib/ratelimit-otp.js — Item 10 Checkpoint 2, Step 5.
//
// The isolated OTP limiter (D8, plans §10.3). This module exists only for
// the OTP surface — it does not export a generic limiter, does not accept
// an endpoint name, and imports no configuration from any other limiter
// module. api/_lib/ratelimit-poll.js (Item 24, rl:poll:) and R-1's future
// scan limiter (rl:scan:, not yet built) are separate modules that happen
// to share the same physical Upstash Redis instance — never the counters,
// never the key prefix, never this file.
//
// Every key this module writes begins with `rl:otp:`. No other module may
// write that prefix.
//
// Mechanism: fixed-window counters via Upstash's REST API (INCR, then
// EXPIRE only on the first increment in a window) over plain `fetch` — no
// new npm dependency (plans §10.6 verification #21). Same primitive
// ratelimit-poll.js already uses.
//
// Email keys are `sha256(email.trim().toLowerCase())`, never the raw
// address, so the rate-limit store holds no readable email addresses (D9).
//
// FAILURE MODE — the opposite of ratelimit-poll.js's fail-open: this module
// FAILS CLOSED (D10). If the store is unreachable, every check below
// resolves `{ outcome: 'unavailable' }` and the calling endpoint must
// refuse the request with 503 `auth_unavailable`. Failing open on an
// endpoint that dispatches paid transactional email is unbounded cost and,
// worse, invites the sending domain to be reported as spam — reputational
// damage measured in weeks, not minutes (plans §10.3).
//
// Alerting on a store outage is meant to run through api/_lib/ops-alert.js
// -> OPS_ALERT_EMAIL via Resend (plans §10.3, citing Item 19 §19.3 / SJ10).
// THAT MODULE DOES NOT EXIST YET — Item 19 has not been built. Building it
// here would be out of this checkpoint's scope (Checkpoint 2 is Item 10
// Steps 5-7 only). tryOpsAlert() below is written to pick it up
// automatically, with zero changes to this file, the moment Item 19 ships
// api/_lib/ops-alert.js exporting `sendOpsAlert(message)`. Until then, a
// store outage still correctly fails closed (503) — only the *alert
// dispatch* is unavailable, and that gap is logged loudly so it is never a
// silent one. See the Checkpoint 2 handback report for this flagged as an
// open item, not a defect.

const crypto = require('crypto');

const KEY_PREFIX = 'rl:otp:';

/**
 * D9 limiter table (plans §10.3):
 *
 *   rl:otp:send:email:<hash>       1  / 60s     impatient repeat taps
 *   rl:otp:send:email:<hash>:h     5  / 1h       sustained mailbox bombing
 *   rl:otp:send:email:<hash>:d     10 / 24h      slow-drip mailbox bombing
 *   rl:otp:send:ip:<ip>:h          10 / 1h       account farming
 *   rl:otp:send:ip:<ip>:d          30 / 24h      slow-drip account farming
 *   rl:otp:verify:email:<hash>:h   20 / 1h       brute-forcing a 6-digit code
 *   rl:otp:verify:ip:<ip>:h        60 / 1h       distributed guessing
 */
const SEND_EMAIL_CHECKS = [
  { suffix: '', limit: 1, windowSeconds: 60 },
  { suffix: ':h', limit: 5, windowSeconds: 3600 },
  { suffix: ':d', limit: 10, windowSeconds: 86400 },
];
const SEND_IP_CHECKS = [
  { suffix: ':h', limit: 10, windowSeconds: 3600 },
  { suffix: ':d', limit: 30, windowSeconds: 86400 },
];
const VERIFY_EMAIL_CHECKS = [{ suffix: ':h', limit: 20, windowSeconds: 3600 }];
const VERIFY_IP_CHECKS = [{ suffix: ':h', limit: 60, windowSeconds: 3600 }];

function hashEmail(email) {
  return crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
}

// Same convention as ratelimit-poll.js: leftmost x-forwarded-for entry, with
// a socket fallback. Per D9/plans §10.3: "Where a client IP genuinely cannot
// be determined, the IP-keyed checks are skipped and the email-keyed checks
// alone apply — an absent IP must never be treated as a shared bucket."
function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  const remoteAddress = req.socket && req.socket.remoteAddress;
  return remoteAddress || null;
}

async function upstashCommand(url, token, parts) {
  const path = parts.map((part) => encodeURIComponent(String(part))).join('/');
  const response = await fetch(`${url}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Upstash command failed: ${response.status}`);
  }
  const body = await response.json();
  return body && body.result;
}

// INCR the key; EXPIRE it only on the first increment in the window (fixed
// window, not sliding — same mechanism as ratelimit-poll.js). Returns the
// post-increment count.
async function bumpWindow(url, token, key, windowSeconds) {
  const count = Number(await upstashCommand(url, token, ['INCR', key]));
  if (count === 1) {
    try {
      await upstashCommand(url, token, ['EXPIRE', key, String(windowSeconds)]);
    } catch (expireErr) {
      // Non-fatal: a key that never expires only makes this limiter
      // stricter later, never looser — same reasoning as ratelimit-poll.js.
      console.error('ratelimit-otp: EXPIRE failed (non-fatal):', expireErr.message);
    }
  }
  return count;
}

// Seconds remaining on a key's window, for an accurate Retry-After. Falls
// back to the check's own window length if TTL is unavailable (-1: no
// expiry set, -2: key gone, or the TTL call itself failed) rather than
// leaving retryAfterSeconds undefined.
async function ttlOrFallback(url, token, key, fallbackSeconds) {
  try {
    const ttl = Number(await upstashCommand(url, token, ['TTL', key]));
    return ttl > 0 ? ttl : fallbackSeconds;
  } catch {
    return fallbackSeconds;
  }
}

let opsAlertUnavailableLogged = false;

async function tryOpsAlert(message) {
  let opsAlert;
  try {
    // eslint-disable-next-line global-require
    opsAlert = require('./ops-alert');
  } catch {
    if (!opsAlertUnavailableLogged) {
      opsAlertUnavailableLogged = true;
      console.error(
        'ratelimit-otp: OTP limiter store unreachable, and api/_lib/ops-alert.js does not exist yet ' +
          '(Item 19 / SJ10 scope, not built as of Item 10 Checkpoint 2) — refusing the request (fail-closed, ' +
          'D10) but NO ALERT EMAIL WAS SENT. This gap closes automatically once Item 19 ships ops-alert.js.'
      );
    }
    return;
  }
  if (opsAlert && typeof opsAlert.sendOpsAlert === 'function') {
    try {
      await opsAlert.sendOpsAlert(message);
    } catch (alertErr) {
      console.error('ratelimit-otp: ops-alert dispatch itself failed:', alertErr.message);
    }
  }
}

/**
 * Run one group of fixed-window checks (all incremented unconditionally —
 * a limiter that only counts successes counts nothing, per D9/plans §10.3).
 * Returns { limited, retryAfterSeconds }.
 */
async function runChecks(url, token, checks) {
  let limited = false;
  let retryAfterSeconds = 0;
  for (const check of checks) {
    // eslint-disable-next-line no-await-in-loop
    const count = await bumpWindow(url, token, check.key, check.windowSeconds);
    if (count > check.limit) {
      limited = true;
      // eslint-disable-next-line no-await-in-loop
      const ttl = await ttlOrFallback(url, token, check.key, check.windowSeconds);
      retryAfterSeconds = Math.max(retryAfterSeconds, ttl);
    }
  }
  return { limited, retryAfterSeconds };
}

function buildSendChecks(emailHash, ip) {
  const checks = SEND_EMAIL_CHECKS.map((c) => ({
    key: `${KEY_PREFIX}send:email:${emailHash}${c.suffix}`,
    windowSeconds: c.windowSeconds,
    limit: c.limit,
  }));
  if (ip) {
    for (const c of SEND_IP_CHECKS) {
      checks.push({ key: `${KEY_PREFIX}send:ip:${ip}${c.suffix}`, windowSeconds: c.windowSeconds, limit: c.limit });
    }
  }
  return checks;
}

function buildVerifyChecks(emailHash, ip) {
  const checks = VERIFY_EMAIL_CHECKS.map((c) => ({
    key: `${KEY_PREFIX}verify:email:${emailHash}${c.suffix}`,
    windowSeconds: c.windowSeconds,
    limit: c.limit,
  }));
  if (ip) {
    for (const c of VERIFY_IP_CHECKS) {
      checks.push({ key: `${KEY_PREFIX}verify:ip:${ip}${c.suffix}`, windowSeconds: c.windowSeconds, limit: c.limit });
    }
  }
  return checks;
}

/**
 * Check-and-increment every send-side counter for one `POST
 * /api/auth/request-code` attempt. Increments BEFORE dispatch is the
 * caller's responsibility — this function only reports the outcome; the
 * caller must not call sendOtp() if `outcome !== 'ok'`, and must still count
 * the attempt (which this function already did) even if the upstream send
 * later fails.
 *
 * @param {object} req
 * @param {string} email
 * @returns {Promise<{outcome: 'ok'} | {outcome: 'limited', retryAfterSeconds: number} | {outcome: 'unavailable'}>}
 */
async function checkRequestCode(req, email) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    await tryOpsAlert('ratelimit-otp: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured — OTP send/verify refused (fail-closed, D10).');
    return { outcome: 'unavailable' };
  }

  const emailHash = hashEmail(email);
  const ip = clientIp(req);
  const checks = buildSendChecks(emailHash, ip);

  try {
    const { limited, retryAfterSeconds } = await runChecks(url, token, checks);
    return limited ? { outcome: 'limited', retryAfterSeconds } : { outcome: 'ok' };
  } catch (err) {
    await tryOpsAlert(`ratelimit-otp: Upstash store unreachable during request-code check: ${err.message}`);
    return { outcome: 'unavailable' };
  }
}

/**
 * Check-and-increment every verify-side counter for one `POST
 * /api/auth/verify-code` attempt. Must be called — and must count — on
 * EVERY attempt including a wrong code, per D9 ("a limiter that only counts
 * successes counts nothing").
 *
 * @param {object} req
 * @param {string} email
 * @returns {Promise<{outcome: 'ok'} | {outcome: 'limited', retryAfterSeconds: number} | {outcome: 'unavailable'}>}
 */
async function checkVerifyCode(req, email) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    await tryOpsAlert('ratelimit-otp: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured — OTP send/verify refused (fail-closed, D10).');
    return { outcome: 'unavailable' };
  }

  const emailHash = hashEmail(email);
  const ip = clientIp(req);
  const checks = buildVerifyChecks(emailHash, ip);

  try {
    const { limited, retryAfterSeconds } = await runChecks(url, token, checks);
    return limited ? { outcome: 'limited', retryAfterSeconds } : { outcome: 'ok' };
  } catch (err) {
    await tryOpsAlert(`ratelimit-otp: Upstash store unreachable during verify-code check: ${err.message}`);
    return { outcome: 'unavailable' };
  }
}

module.exports = { checkRequestCode, checkVerifyCode, hashEmail };
