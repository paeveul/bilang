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
// First-time sign-in needs the terms acceptance (§10.3, D15). The server only
// reveals that by refusing with terms_not_accepted, after the code is already
// spent. So the screen goes back to the email step, shows the terms box, and
// the user asks for a fresh code. The terms version is read from
// VITE_TERMS_VERSION (see termsVersionFrom in ../auth/auth-flow.js) and is not
// hardcoded here.
import { useEffect, useState } from 'react';
import { AuthError, requestCode, verifyCode } from '../../js/auth-client.js';
import {
  RESEND_COOLDOWN_SECONDS,
  normaliseCode,
  serverMessage,
  termsVersionFrom,
} from '../auth/auth-flow.js';

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
  const [needsTerms, setNeedsTerms] = useState(false);
  const [termsTicked, setTermsTicked] = useState(false);
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
      await requestCode(address);
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
    const terms = needsTerms
      ? { termsAccepted: termsTicked, ...(termsVersion ? { termsVersion } : {}) }
      : {};
    try {
      await verifyCode(sentTo, normaliseCode(code), terms);
      onSignedIn();
    } catch (err) {
      if (err instanceof AuthError && err.code === 'terms_not_accepted') {
        setNeedsTerms(true);
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
  const sendBlocked = busy || (needsTerms && !termsTicked);

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

          {needsTerms && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 rounded border-slate-300"
                checked={termsTicked}
                onChange={(e) => setTermsTicked(e.target.checked)}
              />
              <span className="text-base text-slate-700">
                I agree to the Terms of Service and the Privacy Notice. Tick this to continue.
              </span>
            </label>
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
