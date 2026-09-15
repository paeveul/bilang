// src/screens/ErrorScreen.jsx — Item 22 Step 5 (mechanical, presentational).
// Ported from index.html's data-screen="error" + js/app.js's
// bindErrorScreen(). "Start over" does a hard navigation to "/", matching
// the vanilla behaviour exactly (a full reload clears all in-memory
// creator-flow state, same as resetState() + showScreen('landing') did,
// but via reload rather than in-app reset — kept identical rather than
// "improved" here, since any change to error-recovery behaviour is a
// product decision, not a migration one).
import { useBillState } from '../state/BillContext.jsx';

export default function ErrorScreen() {
  const { errorMessage } = useBillState();
  return (
    <section data-screen="error" className="app-screen py-16 text-center space-y-4">
      <p className="text-4xl">😕</p>
      <p className="text-slate-600">{errorMessage}</p>
      <button
        type="button"
        className="text-sm text-amber-600 underline"
        onClick={() => {
          window.location.href = '/';
        }}
      >
        Start over
      </button>
    </section>
  );
}
