// src/screens/PaymentScreen.jsx — Item 22 Step 7: payment-handle entry
// screen. Ported from index.html's data-screen="payment" +
// js/app.js's bindPayment()/submitSplit(). Display-only field, never
// validated beyond "not empty" — matches vanilla behaviour exactly (the
// payment handle is free text shown as-is on the payer view; validating
// its shape is out of scope everywhere in this codebase, not just here).
//
// submitSplit() calls createSplit() (js/api-client.js, unchanged) — the
// one place /api/split is called from the creator's side of the app.
import { useState } from 'react';
import { createSplit } from '../../js/api-client.js';
import { computeTotals } from '../../js/totals.js';
import { useBillActions, useBillState } from '../state/BillContext.jsx';

export default function PaymentScreen() {
  const { parsed, payers, assignments } = useBillState();
  const { goToScreen, setPaymentHandle, setShareUrl, setError } = useBillActions();
  const [handle, setHandle] = useState('');
  const [validationError, setValidationError] = useState('');

  async function handleCreateSplit() {
    const trimmed = handle.trim();
    if (!trimmed) {
      setValidationError('Enter how people should pay you before continuing.');
      return;
    }
    setValidationError('');
    setPaymentHandle(trimmed);

    goToScreen('creating');

    const { perPerson } = computeTotals(parsed.items, assignments, parsed, payers);
    const totalsPayload = {
      subtotal: parsed.subtotal,
      service_charge: parsed.service_charge,
      tax: parsed.tax,
      grand_total: parsed.grand_total,
      per_person: Object.fromEntries(
        Object.entries(perPerson).map(([name, p]) => [name, Math.round(p.totalCents) / 100])
      ),
    };

    try {
      const { url } = await createSplit({
        items: parsed.items,
        assignments,
        totals: totalsPayload,
        ownerPaymentHandle: trimmed,
      });
      setShareUrl(`${window.location.origin}${url}`);
      goToScreen('share');
    } catch (err) {
      setError(err.message || 'Could not create this split.');
    }
  }

  return (
    <section data-screen="payment" className="app-screen py-8 space-y-4">
      <h2 className="text-xl font-bold">How should people pay you?</h2>
      <p className="text-slate-600 text-sm">
        Enter your DuitNow ID, bank account, or a QR string. This is shown on the shared link so
        people can pay you directly — Paeveul never touches this money.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <label className="block space-y-1">
          <span className="text-sm text-slate-600">Payment details</span>
          <textarea
            rows={3}
            maxLength={200}
            placeholder="e.g. DuitNow: 012-3456789 (Ahmad Bin Ali), or Maybank 1234 5678 9012"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            className="w-full rounded-md border-slate-300 text-sm"
          />
        </label>
      </div>

      {validationError && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {validationError}
        </div>
      )}

      <button
        type="button"
        onClick={handleCreateSplit}
        className="w-full rounded-lg bg-amber-500 text-white font-semibold py-3"
      >
        Create the split
      </button>
      <button
        type="button"
        className="text-sm text-slate-500 underline"
        onClick={() => goToScreen('review')}
      >
        ← Back
      </button>
    </section>
  );
}
