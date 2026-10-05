// src/auth/auth-flow.js — Item 10 Checkpoint 4, Steps 10-11: pure helpers for
// the sign-in screen and the mid-flow re-auth. No JSX and no React in this
// file, so it runs directly under node --test (same reason as
// src/state/bill-reducer.js).
//
// Plans §10.3 "New auth screen": resend control with a visible 60-second
// cooldown matching the server limit.
import { AuthError } from '../../js/auth-client.js';

// Matches the server's 60-second per-address send window (§10.3 limiter table).
export const RESEND_COOLDOWN_SECONDS = 60;

// Six digits, exactly (§10.3, validateOtpVerify). Whitespace is stripped so a
// code pasted as "123 456" still reaches the server as six digits; anything
// else is passed through unchanged and the server's own 400 text is shown.
export function normaliseCode(input) {
  return String(input ?? '').replace(/\s+/g, '');
}

// The terms version is NOT hardcoded (§10.3, terms_version: "No hardcoded
// default"). It is read from a build-time env var, VITE_TERMS_VERSION, which
// Item 14's publication step is expected to set. Returns undefined when unset,
// so the caller sends nothing and the server's own terms_not_accepted text is
// what the user sees.
export function termsVersionFrom(env) {
  const value = env && env.VITE_TERMS_VERSION;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Shown only when the request never reached the server (no status, no body),
// so there is no server text to display. Everything else uses the server's own
// `error` string.
export const NETWORK_FALLBACK_MESSAGE = 'Could not reach Bilang. Check your connection and try again.';

// The text a user sees for a failed auth call. Uses the server's own `error`
// string verbatim (§10.3's error table). Falls back to the network message only
// when there is no server text to show (the request never got an answer).
export function serverMessage(err) {
  if (err instanceof AuthError && typeof err.body?.error === 'string' && err.body.error.length > 0) {
    return err.body.error;
  }
  return NETWORK_FALLBACK_MESSAGE;
}
