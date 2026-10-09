// api/auth/session.js — Vercel serverless function. Item 10 Checkpoint 2,
// Step 7. Extended 2026-10-10 (Tony's approved MVP1 "cheap half", relayed via
// coordinator, bilang-pm-tracker.md v2.80 change-log).
//
// GET /api/auth/session -> 200 { signedIn, accountId? }. NEVER 401 — this
// endpoint answers a question, it does not gate anything (plans §10.3).
// Runs the same refresh path requireAccount uses, so simply opening the app
// extends a rolling session — but writes no error response of its own.
//
// On every successful GET (signedIn: true), this handler also silently
// syncs accounts.terms_version_seen to the currently published
// VITE_TERMS_VERSION when the two differ — Tony's proposal: "add one column
// on accounts, updated silently when a signed-in session loads and differs
// from the current published version." No banner, no email, no copy; the
// response shape is unchanged. A sync failure (missing env var, DB error) is
// logged and swallowed — it must never turn a working session check into an
// error response.
//
// DELETE /api/auth/session -> 204, clears all three cookies. Revokes the
// refresh token upstream on a best-effort basis; a failed upstream revoke
// must never block the local sign-out.

const { readSession, refreshSession, clearSessionCookies, revokeSessionUpstream } = require('../_lib/auth');
const { getTermsVersionSeen, updateTermsVersionSeen } = require('../_lib/supabase');

// Same read-from-env shape as src/auth/auth-flow.js's termsVersionFrom, but
// kept local and reading process.env rather than import.meta.env — this file
// is a CommonJS serverless function, not part of the Vite client bundle, and
// Vercel still sets the real environment variable at runtime regardless of
// its VITE_ prefix.
function publishedTermsVersion() {
  const value = process.env.VITE_TERMS_VERSION;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function syncTermsVersionSeen(accountId) {
  const published = publishedTermsVersion();
  if (!published) return; // nothing published yet — nothing to sync
  try {
    const seen = await getTermsVersionSeen(accountId);
    if (seen !== published) {
      await updateTermsVersionSeen(accountId, published);
    }
  } catch (err) {
    console.error('api/auth/session.js — terms_version_seen sync failed (non-fatal):', err.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const initial = await readSession(req);
    if (!initial.needsRefresh) {
      await syncTermsVersionSeen(initial.accountId);
      res.status(200).json({ signedIn: true, accountId: initial.accountId });
      return;
    }
    const accountId = await refreshSession(req, res);
    if (accountId) {
      await syncTermsVersionSeen(accountId);
      res.status(200).json({ signedIn: true, accountId });
      return;
    }
    res.status(200).json({ signedIn: false });
    return;
  }

  if (req.method === 'DELETE') {
    await revokeSessionUpstream(req); // best-effort; never throws (see auth.js)
    clearSessionCookies(res);
    res.status(204).end();
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
