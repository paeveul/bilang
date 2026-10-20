//
//
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

export function resolveForTest(pathname) {
  return resolve(pathname);
}
