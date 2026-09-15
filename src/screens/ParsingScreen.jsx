// src/screens/ParsingScreen.jsx — Item 22 Step 5 (mechanical, presentational).
// Ported verbatim from index.html's data-screen="parsing" section. Pure
// loading state shown while CaptureScreen's parseReceipt() call is in
// flight — no logic of its own.
export default function ParsingScreen() {
  return (
    <section data-screen="parsing" className="app-screen py-16 text-center space-y-4">
      <div className="animate-spin mx-auto h-10 w-10 rounded-full border-4 border-amber-500 border-t-transparent" />
      <p className="text-slate-600">Reading your receipt…</p>
    </section>
  );
}
