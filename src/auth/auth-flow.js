//
import { AuthError } from '../../js/auth-client.js';

export const RESEND_COOLDOWN_SECONDS = 60;

export function normaliseCode(input) {
  return String(input ?? '').replace(/\s+/g, '');
}

export function termsVersionFrom(env) {
  const value = env && env.VITE_TERMS_VERSION;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Shown only when the request never reached the server (no status, no body),
// so there is no server text to display. Everything else uses the server's own
// `error` string.
export const NETWORK_FALLBACK_MESSAGE = 'Could not reach Bilang. Check your internet and try again.';

export function serverMessage(err) {
  if (err instanceof AuthError && typeof err.body?.error === 'string' && err.body.error.length > 0) {
    return err.body.error;
  }
  return NETWORK_FALLBACK_MESSAGE;
}
