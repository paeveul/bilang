// src/screens/LandingScreen.jsx — Item 22 Step 5 (mechanical, presentational).
// Ported from index.html's data-screen="landing" section + js/app.js's
// bindLanding(). Same copy, same consent-gate behaviour: the "Start a new
// split" button stays disabled until the consent checkbox is ticked.
// Legal panel copy is unchanged placeholder text (Javier's draft copy is
// not yet final) — not this pass's job to alter.
import { useState } from 'react';
import { useBillActions } from '../state/BillContext.jsx';

export default function LandingScreen() {
  const { goToScreen } = useBillActions();
  const [consented, setConsented] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showTos, setShowTos] = useState(false);

  return (
    <section data-screen="landing" className="app-screen py-8 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Split any bill in seconds</h1>
        <p className="text-slate-600">
          Snap a photo of the receipt, confirm the items, say who had what — everyone gets a link
          with their share and how to pay.
        </p>
      </div>

      <ul className="text-sm text-slate-600 space-y-2 bg-white rounded-xl border border-slate-200 p-4">
        <li className="flex gap-2">
          <span>✅</span>
          <span>No accounts, no app to install</span>
        </li>
        <li className="flex gap-2">
          <span>✅</span>
          <span>You always review and can fix what the photo scan got wrong</span>
        </li>
        <li className="flex gap-2">
          <span>✅</span>
          <span>
            Payment happens directly between you and your friends — this tool never touches your
            money
          </span>
        </li>
      </ul>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
          />
          <span className="text-sm text-slate-700">
            I agree to the{' '}
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2"
              onClick={() => setShowPrivacy(true)}
            >
              Privacy Notice
            </button>{' '}
            and{' '}
            <button
              type="button"
              className="underline decoration-dotted underline-offset-2"
              onClick={() => setShowTos(true)}
            >
              Terms of Service
            </button>
            , and understand my receipt photo is sent to Anthropic (the maker of the Claude AI
            model) to be read, and is never stored afterwards.
          </span>
        </label>
        <button
          type="button"
          disabled={!consented}
          onClick={() => consented && goToScreen('capture')}
          className="w-full rounded-lg bg-amber-500 text-white font-semibold py-3 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          Start a new split
        </button>
      </div>

      {showPrivacy && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600 space-y-2">
          <h2 className="font-semibold text-slate-900">Privacy Notice</h2>
          <p>
            [PLACEHOLDER — Javier to draft final copy] This app sends your receipt photo to
            Anthropic's Claude AI model (processed in the United States) to read the items on it.
            The photo itself is never saved — it exists only for the few seconds it takes to read
            it, then it is discarded. What IS saved: the item names/amounts you confirm, the names
            of people you assign items to, the totals, and the bill owner's payment details
            (DuitNow ID / bank account / QR) — all shown on the shareable link. This data is kept
            for a limited time and then deleted.
          </p>
          <button
            type="button"
            className="text-amber-600 font-medium"
            onClick={() => setShowPrivacy(false)}
          >
            Close
          </button>
        </div>
      )}

      {showTos && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-600 space-y-2">
          <h2 className="font-semibold text-slate-900">Terms of Service</h2>
          <p>
            [PLACEHOLDER — Javier to draft final copy] Bilang is a free tool that helps you
            itemise a receipt and calculate who owes what. Paeveul never collects, holds, or moves
            any money — every payment happens directly between you and the people you split with,
            using whatever payment details the bill owner enters. Paeveul is not a party to that
            payment and is not responsible for it being sent, received, or correct.
          </p>
          <button type="button" className="text-amber-600 font-medium" onClick={() => setShowTos(false)}>
            Close
          </button>
        </div>
      )}
    </section>
  );
}
