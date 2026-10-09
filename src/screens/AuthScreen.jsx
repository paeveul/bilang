// src/screens/AuthScreen.jsx — Item 10 Checkpoint 4, Step 10 (sign-in) and
// Step 11 (in-place re-auth, rendered as an overlay).
//
// Two steps, one screen: email first, then the six-digit code. Plans §10.3
// "New auth screen": email field, then code field, resend control with a
// visible 60-second cooldown, and a plain error area. Every error shown is the
// server's own `error` text (serverMessage in ../auth/auth-flow.js). Only a
// request that never got an answer uses the network fallback.
//
// variant="page"    — the full sign-in screen, shown before the creator flow.
// variant="overlay" — the same form shown above the current screen after a
//                     session_expired error (Step 11). The screen underneath
//                     stays mounted, so nothing the user typed is lost.
//
// Terms tick moved to the email step (Alex, 2026-10-10 — bilang-pm-tracker.md
// v2.78 change-log): shown to every user, before any code is sent, not just
// first-time accounts. "Send me a code" stays disabled until ticked, and the
// code is only SENT after the tick — api/auth/request-code.js now refuses
// before dispatch (and before the limiter increments) if the tick fields are
// missing, so a refused first-time account never burns a code. The server's
// own D15 check at verify-code.js stays in place underneath as a
// defense-in-depth belt-and-braces check; it should not normally fire from
// this screen since the tick already happened before request-code was ever
// called. The terms version is read from VITE_TERMS_VERSION (see
// termsVersionFrom in ../auth/auth-flow.js) and is not hardcoded here.
//
// Visible links to the mock Terms of Service / Privacy Notice sit right next
// to the tick (not footer-only) — see src/legal/mock-legal-content.js for the
// placeholder copy itself.
import { useEffect, useState } from 'react';
import { AuthError, requestCode, verifyCode } from '../../js/auth-client.js';
import {
  RESEND_COOLDOWN_SECONDS,
  normaliseCode,
  serverMessage,
  termsVersionFrom,
} from '../auth/auth-flow.js';
import { MOCK_PRIVACY_NOTICE, MOCK_TERMS_OF_SERVICE } from '../legal/mock-legal-content.js';

const BUTTON =
  'w-full rounded-lg bg-amber-500 text-white font-semibold text-lg py-3 min-h-[48px] transition disabled:opacity-40 disabled:cursor-not-allowed';
const INPUT = 'w-full rounded-lg border-slate-300 text-lg px-4 py-3 min-h-[48px]';

export default function AuthScreen({
  variant = 'page',
  onSignedIn,
  startupError = '',
  cooldownSeconds = RESEND_COOLDOWN_SECONDS,
  termsVersion = termsVersionFrom(import.meta.env),
}) {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [termsTicked, setTermsTicked] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [error, setError] = useState(startupError);
  const [busy, setBusy] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  // One-second tick while the resend cooldown runs.
  useEffect(() => {
    if (cooldownLeft <= 0) return undefined;
    const timer = setTimeout(() => setCooldownLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldownLeft]);

  async function sendCode(address) {
    setBusy(true);
    setError('');
    try {
      await requestCode(address, {
        termsAccepted: termsTicked,
        ...(termsVersion ? { termsVersion } : {}),
      });
      setSentTo(address);
      setCode('');
      setStep('code');
      setCooldownLeft(cooldownSeconds);
    } catch (err) {
      setError(serverMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    await sendCode(email.trim());
  }

  async function handleCodeSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    // The tick already happened on the email step, before this code was ever
    // sent — so this always carries the same acceptance the request-code
    // call just made. Still sent every time (not conditionally), matching
    // the server's own defense-in-depth check at verify-code.js (D15).
    const terms = { termsAccepted: termsTicked, ...(termsVersion ? { termsVersion } : {}) };
    try {
      await verifyCode(sentTo, normaliseCode(code), terms);
      onSignedIn();
    } catch (err) {
      if (err instanceof AuthError && err.code === 'terms_not_accepted') {
        // Should not normally happen from this screen (the tick already
        // gated the code being sent) — but if the server still refuses, the
        // code is already spent, so the only way forward is a fresh one.
        setStep('email');
        setCode('');
      }
      setError(serverMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function useDifferentEmail() {
    setStep('email');
    setCode('');
    setError('');
  }

  const heading = variant === 'overlay' ? 'Sign in to keep going' : 'Sign in to Bilang';
  const sendBlocked = busy || !termsTicked;

  return (
    <section data-screen="auth" aria-labelledby="auth-heading" className="app-screen py-8 space-y-5">
      <div className="space-y-2">
        <h2 id="auth-heading" className="text-2xl font-bold">
          {heading}
        </h2>
        {variant === 'overlay' && (
          <p className="text-slate-600 text-base">
            Your split is still here. Sign in and carry on where you left off.
          </p>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-base p-3">
          {error}
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="auth-email" className="block text-base font-medium text-slate-800">
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              autoFocus={variant === 'overlay'}
              aria-describedby="auth-email-help"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT}
            />
            <p id="auth-email-help" className="text-sm text-slate-500">
              We will email you a six-digit code. No password needed.
            </p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 rounded border-slate-300"
              checked={termsTicked}
              onChange={(e) => setTermsTicked(e.target.checked)}
            />
            <span className="text-base text-slate-700">
              I agree to the{' '}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2"
                onClick={() => setShowTerms(true)}
              >
                Terms of Service
              </button>{' '}
              and{' '}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2"
                onClick={() => setShowPrivacy(true)}
              >
                Privacy Notice
              </button>
              . Tick this to continue.
            </span>
          </label>

          {showTerms && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600 space-y-2">
              <h3 className="font-semibold text-slate-900">Terms of Service</h3>
              <p>{MOCK_TERMS_OF_SERVICE}</p>
              <button
                type="button"
                className="text-amber-600 font-medium"
                onClick={() => setShowTerms(false)}
              >
                Close
              </button>
            </div>
          )}

          {showPrivacy && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600 space-y-2">
              <h3 className="font-semibold text-slate-900">Privacy Notice</h3>
              <p>{MOCK_PRIVACY_NOTICE}</p>
              <button
                type="button"
                className="text-amber-600 font-medium"
                onClick={() => setShowPrivacy(false)}
              >
                Close
              </button>
            </div>
          )}

          <button type="submit" disabled={sendBlocked} className={BUTTON}>
            {busy ? 'Sending…' : 'Send me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCodeSubmit} className="space-y-4">
          <p className="text-slate-600 text-base break-words">
            We sent a six-digit code to <strong>{sentTo}</strong>. It expires in 10 minutes.
          </p>

          <div className="space-y-2">
            <label htmlFor="auth-code" className="block text-base font-medium text-slate-800">
              Six-digit code
            </label>
            <input
              id="auth-code"
              type="text"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-lg border-slate-300 text-2xl tracking-[0.4em] text-center px-4 py-3 min-h-[56px]"
            />
          </div>

          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 text-base">
            <button
              type="button"
              disabled={busy || cooldownLeft > 0}
              onClick={() => sendCode(sentTo)}
              className="min-h-[44px] min-w-[10rem] px-1 text-left tabular-nums text-amber-700 font-medium disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              {cooldownLeft > 0 ? `Resend in ${cooldownLeft}s` : 'Resend code'}
            </button>
            <button
              type="button"
              onClick={useDifferentEmail}
              className="min-h-[44px] px-1 text-slate-600 underline"
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
