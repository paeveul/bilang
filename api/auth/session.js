// api/auth/session.js — Vercel serverless function. Item 10 Checkpoint 2,
// Step 7.
//
// GET /api/auth/session -> 200 { signedIn, accountId? }. NEVER 401 — this
// endpoint answers a question, it does not gate anything (plans §10.3).
// Runs the same refresh path requireAccount uses, so simply opening the app
// extends a rolling session — but writes no error response of its own.
//
// DELETE /api/auth/session -> 204, clears all three cookies. Revokes the
// refresh token upstream on a best-effort basis; a failed upstream revoke
// must never block the local sign-out.

const { readSession, refreshSession, clearSessionCookies, revokeSessionUpstream } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const initial = await readSession(req);
    if (!initial.needsRefresh) {
      res.status(200).json({ signedIn: true, accountId: initial.accountId });
      return;
    }
    const accountId = await refreshSession(req, res);
    if (accountId) {
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
