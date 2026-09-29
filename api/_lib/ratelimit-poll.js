// api/_lib/ratelimit-poll.js — Item 24 Step 5
//
// Fixed-window rate limiter guarding GET and PATCH /api/split (Item 24 C11/
// C13): the anonymous payer link's read/claim surface. Own module, own
// configuration, own key namespace — imports nothing from any other limiter
// (there is no other limiter module in this codebase yet; this constraint
// still applies when one is added later, per Item 24 C11 / plans §24.3).
//
// Mechanism: INCR the key, then EXPIRE it only on the first increment in the
// window (count === 1) — a fixed window, not a sliding one. Store: Upstash
// Redis REST API over plain `fetch`, no new dependency (Standing Rule 3a).
//
// Key: `rl:poll:<ip>` (Item 24 Q4, Alex 2026-09-25 — count by IP, read only
// inside this module, never written to any table or returned to a caller).
// Ceiling: 900 requests/minute/key (Tony, Open Item 14b, 2026-09-26) — a
// config constant independent of the client's own decay schedule (plans
// §24.3), which paces a well-behaved client; this ceiling exists to stop
// abuse or a misbehaving client regardless of how it paces itself.
//
// Fails open on a store outage: a poll must not break because Redis is
// down. Logs once per outage (not once per request), and once again if a
// new outage starts after a recovery — never per attempted request.

const WINDOW_SECONDS = 60;
const LIMIT_PER_WINDOW = 900;
const KEY_PREFIX = 'rl:poll:';

let outageActive = false;

function warnOutageStart(message) {
  if (outageActive) return;
  outageActive = true;
  console.error(message);
}

function clearOutage() {
  outageActive = false;
}

function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  const remoteAddress = req.socket && req.socket.remoteAddress;
  return remoteAddress || 'unknown';
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

/**
 * Resolve true when the request should be refused (429). Resolve false
 * whenever the request should proceed — including every store-outage path,
 * by design (fail open).
 */
async function pollRateLimited(req) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    warnOutageStart(
      'ratelimit-poll: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured — failing open'
    );
    return false;
  }

  const key = `${KEY_PREFIX}${clientIp(req)}`;

  try {
    const count = Number(await upstashCommand(url, token, ['INCR', key]));
    if (count === 1) {
      // Opens the fixed window. A failure here must not fail the request
      // closed — a key that never expires just means the next outage-free
      // request re-INCRs an old window, which only makes the limiter
      // stricter, never lets more through, so it is safe to swallow.
      try {
        await upstashCommand(url, token, ['EXPIRE', key, String(WINDOW_SECONDS)]);
      } catch (expireErr) {
        console.error('ratelimit-poll: EXPIRE failed (non-fatal):', expireErr.message);
      }
    }
    clearOutage();
    return count > LIMIT_PER_WINDOW;
  } catch (err) {
    warnOutageStart(`ratelimit-poll: Upstash store unreachable, failing open: ${err.message}`);
    return false;
  }
}

module.exports = { pollRateLimited };
