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
// NOTE ON "ten routes" (flagged in the Step 2 dispatch report for Alex):
// the current (pre-migration) app has exactly two real URL shapes. The
// other eight/nine "screens" are internal show/hide states reached via
// in-page navigation with no URL change at all (see js/app.js's
// `showScreen()` — actually named differently there, see that file).
// This router preserves that distinction rather than inventing nine new
// URLs no design spec has asked for.
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
