// api/_lib/cookies.js — Item 10 Checkpoint 1, Step 4.
//
// Small, dependency-free cookie helpers. Deliberately no product logic: this
// module knows nothing about session cookies, account ids, or auth — it does
// not know the names `bilang_at` / `bilang_rt` / `bilang_sa` exist. That
// knowledge belongs to api/_lib/auth.js (Item 10 Step 6, not built yet).
//
// serializeCookie always applies the security-flag set the D3/10.3 cookie
// spec in bilang-mvp1-implementation-plans.md §10.3 requires of every Bilang
// cookie — HttpOnly, Secure, SameSite=Lax, Path=/ — because this repo has
// exactly one cookie use case (first-party session cookies) and no reason to
// ship a general-purpose serializer that could produce a non-HttpOnly or
// non-Secure cookie by omission.

/**
 * Read one cookie's value from a request's `Cookie` header.
 *
 * @param {object} req - a request-like object with a `.headers` map (works
 *   against both Vercel's `VercelRequest` and a plain fake `{ headers }`).
 * @param {string} name - the cookie name to look up.
 * @returns {string|null} the decoded value, or null if absent or the header
 *   is missing entirely.
 */
function readCookie(req, name) {
  const header = req && req.headers && req.headers.cookie;
  if (typeof header !== 'string' || header.length === 0) return null;

  const target = String(name);
  const pairs = header.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    if (key !== target) continue;
    const rawValue = pair.slice(eqIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      // Malformed percent-encoding — return the raw value rather than throw.
      return rawValue;
    }
  }
  return null;
}

/**
 * Build one `Set-Cookie` header value.
 *
 * @param {string} name
 * @param {string} value - will be percent-encoded.
 * @param {number} maxAgeSeconds - seconds until expiry. Pass 0 to expire the
 *   cookie immediately (also emits a past `Expires` date for clients that
 *   honour `Expires` over `Max-Age`); pass a positive integer for a normal
 *   cookie lifetime.
 * @returns {string} a value suitable for the `Set-Cookie` response header.
 */
function serializeCookie(name, value, maxAgeSeconds) {
  const segments = [`${name}=${encodeURIComponent(value)}`];

  if (maxAgeSeconds === 0) {
    segments.push('Max-Age=0');
    segments.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  } else if (typeof maxAgeSeconds === 'number' && Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
    segments.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  }

  segments.push('Path=/');
  segments.push('HttpOnly');
  segments.push('Secure');
  segments.push('SameSite=Lax');

  return segments.join('; ');
}

module.exports = { readCookie, serializeCookie };
