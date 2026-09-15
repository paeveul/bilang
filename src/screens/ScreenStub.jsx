// src/screens/ScreenStub.jsx — placeholder, now used for exactly one
// screen: 'review'. Steps 5, 6 and 7 (this pass and the prior one) gave
// every other screen real content; 'review' stays a stub because it IS
// Item 22 Step 8 (the Round 2 correction-screen rebuild), gated on
// §22.7 Q1 and explicitly out of scope until that question is answered —
// see App.jsx's header comment for the full reasoning and the flagged
// consequence for end-to-end UI testing in the meantime.
export default function ScreenStub({ name, screenNumber }) {
  return (
    <section data-screen={name} className="app-screen py-8 space-y-4">
      <p className="text-xs text-slate-400">
        Screen {screenNumber}/10 — <code>{name}</code> — not yet migrated (Item 22, Step 8 — gated
        on §22.7 Q1)
      </p>
    </section>
  );
}
