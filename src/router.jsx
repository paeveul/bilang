// src/router.jsx — Item 22 Step 2: a minimal client-side router.
//
// Deliberately hand-rolled rather than react-router-dom (F6, F9's
// zero-extra-dependency precedent, B1's bundle budget). Recognises
// exactly the two URL shapes the app has today:
//   - "/"        — the single-page screen state machine (landing,
//                  capture, parsing, review, assign, payment, creating,
//                  share, error — none of these have their own URL today).
//   - "/s/:id"   — the payer view. F6: must resolve byte-for-byte as
//                  today's regex does. This is the one route with an
//                  irreversible-failure consequence (existing WhatsApp
//                  links) — its match pattern is kept character-identical
//                  to js/app.js's own regex on purpose, not just similar.
//
// ROUTING SHAPE — RESOLVED, 2026-09-14 (was flagged "ten routes?" in the
// Step 2 dispatch report). Alex's final decision, adopting Tony's
// product/UX recommendation over Howard's own earlier revised technical
// read: exactly 4 real, individually-addressable URLs total — homepage
// ("/"), this file's "/s/:id" (the payer link, untouched throughout),
// plus two NOT YET BUILT by this item — the credit-pack picker (item 11)
// and account settings (item 18). The other six in-flow screens (capture,
// review/parse, assign, roster, correction, payment-handle) stay
// internal, session-only state with no URL of their own — exactly what
// this router already implements below; no route-count change was
// needed to match the final shape. When items 11 and 18 build their
// screens, they add their own real-URL entries to `resolve()` below,
// against the structure this item establishes (22.5) — this file does
// not stub them out in advance, since Item 22's own scope explicitly
// excludes building those screens (22 intro, "does not build any new
// screen").
// Full reasoning: `01-paeveul-main/product-owner-agent-room/deliverables/
// decision-log-bilang-screen-routing-v1.md` (Tony), cross-referenced from
// `bilang-mvp1-implementation-plans.md` Item 22 and from
// `bilang/pm/bilang-pm-tracker.md` §1b.2.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Byte-identical to js/app.js's existing payer-view match, on purpose —
// do not "clean up" this regex without re-verifying against the original.
const SHARE_ID_PATTERN = /^\/s\/([A-Za-z0-9]+)\/?$/;

function resolve(pathname) {
  const shareMatch = pathname.match(SHARE_ID_PATTERN);
  if (shareMatch) {
    return { route: 'payer', params: { id: shareMatch[1] } };
  }
  return { route: 'app', params: {} };
}

const RouterContext = createContext(null);

export function RouterProvider({ children }) {
  const [location, setLocation] = useState(() => resolve(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setLocation(resolve(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((path) => {
    window.history.pushState(null, '', path);
    setLocation(resolve(path));
  }, []);

  return (
    <RouterContext.Provider value={{ ...location, navigate }}>{children}</RouterContext.Provider>
  );
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter() called outside <RouterProvider>');
  return ctx;
}

// Exported for the Step 2 local verification harness only — not used by
// the app itself.
export function resolveForTest(pathname) {
  return resolve(pathname);
}
