// src/screens/PayerScreen.jsx — the /s/:id route target.
// Step 2 stub only: proves the router extracts `id` correctly from the
// URL and mounts this screen. Real content (fetch split, render items,
// the security fix for `item.qty`) is Step 6's job — not built here.
export default function PayerScreen({ id }) {
  return (
    <div className="mx-auto max-w-lg px-4 pb-16">
      <section data-screen="payer" className="app-screen py-8 space-y-4">
        <p className="text-xs text-slate-400">
          Screen 10/10 — <code>payer</code> — not yet migrated (Item 22, Step 6)
        </p>
        <p className="text-sm text-slate-500">
          Resolved split id from URL: <code>{id}</code>
        </p>
      </section>
    </div>
  );
}
