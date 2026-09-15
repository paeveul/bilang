// src/screens/CreatingScreen.jsx — Item 22 Step 7 (mechanical support for
// the payment-handle flow). Ported verbatim from index.html's
// data-screen="creating" section. Pure loading state shown while
// PaymentScreen's createSplit() call is in flight.
export default function CreatingScreen() {
  return (
    <section data-screen="creating" className="app-screen py-16 text-center space-y-4">
      <div className="animate-spin mx-auto h-10 w-10 rounded-full border-4 border-amber-500 border-t-transparent" />
      <p className="text-slate-600">Creating your split…</p>
    </section>
  );
}
