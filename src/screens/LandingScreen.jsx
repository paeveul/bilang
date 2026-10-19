// src/screens/LandingScreen.jsx — Item 22 Step 5 (mechanical, presentational).
// Ported from index.html's data-screen="landing" section + js/app.js's
// bindLanding().
//
// 2026-10-19 (Alex's request, relayed via the orchestrator): Landing no longer
// has a consent tick, state or legal panels. The one and only consent tick is
// on the sign-in screen (src/screens/AuthScreen.jsx) and covers Terms, Privacy
// Notice and the receipt-photo disclosure; the wording now lives in
// src/legal/mock-legal-content.js. "Start a new split" goes straight to
// capture. The "No accounts, no app to install" bullet below is intentionally
// untouched (a separate follow-up is being decided).
import { useBillActions } from '../state/BillContext.jsx';

export default function LandingScreen() {
  const { goToScreen } = useBillActions();

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
          <span>No app to install, and the friends you split with don't need an account</span>
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

      <button
        type="button"
        onClick={() => goToScreen('capture')}
        className="w-full rounded-lg bg-amber-500 text-white font-semibold py-3 transition"
      >
        Start a new split
      </button>
    </section>
  );
}
