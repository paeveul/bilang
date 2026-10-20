//
//
//
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getSession, isSessionExpired } from '../../js/auth-client.js';
import { serverMessage } from './auth-flow.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // 'checking' | 'signed-out' | 'signed-in'
  const [phase, setPhase] = useState('checking');
  // The server's message when the startup session check failed (e.g. 503).
  const [startupError, setStartupError] = useState('');
  const [overlayOpen, setOverlayOpen] = useState(false);
  // Resolver for the one re-auth that is currently waiting on the user.
  const reauthResolveRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getSession().then(
      (session) => {
        if (cancelled) return;
        setPhase(session.signedIn ? 'signed-in' : 'signed-out');
      },
      (err) => {
        if (cancelled) return;
        setStartupError(serverMessage(err));
        setPhase('signed-out');
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const markSignedIn = useCallback(() => {
    setPhase('signed-in');
    setOverlayOpen(false);
    setStartupError('');
    const resolve = reauthResolveRef.current;
    reauthResolveRef.current = null;
    if (resolve) resolve();
  }, []);

  const requestReauth = useCallback(
    () =>
      new Promise((resolve) => {
        reauthResolveRef.current = resolve;
        setOverlayOpen(true);
      }),
    []
  );

  // Runs one creator request. Retries the same request after each successful
  // in-place sign-in. Any other error is rethrown to the caller unchanged.
  const runWithSession = useCallback(
    async (request) => {
      for (;;) {
        try {
          return await request();
        } catch (err) {
          if (!isSessionExpired(err)) throw err;
          await requestReauth();
        }
      }
    },
    [requestReauth]
  );

  return (
    <AuthContext.Provider value={{ phase, startupError, overlayOpen, markSignedIn, runWithSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() called outside <AuthProvider>');
  return ctx;
}
