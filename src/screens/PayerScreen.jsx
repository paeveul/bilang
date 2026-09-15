// src/screens/PayerScreen.jsx — Item 22 Step 6: the /s/:id route target,
// real content (replaces the Step 2 stub — see git history for that
// version, which only proved the router extracted `id` correctly).
//
// Ported from index.html's data-screen="payer" section + js/app.js's
// renderPayerView(). Read-only. Fetches via getSplit() (js/api-client.js,
// unchanged, now on /api/v1/* per Step 3 — F6's byte-for-byte URL
// requirement is about the PAGE route, "/s/<id>", which this screen does
// not change at all; router.jsx's SHARE_ID_PATTERN, untouched since
// Step 2, is what actually guarantees that).
//
// THE SECURITY FIX lives in payer-item-row.js (imported below), not here
// — see that file's header comment and its kept test,
// payer-item-row.security.test.mjs (22.4 Step 6 / 22.6 point 2).
import { useEffect, useState } from 'react';
import { getSplit } from '../../js/api-client.js';
import { formatRM } from '../../js/totals.js';
import { PayerItemRow } from './payer-item-row.js';

export default function PayerScreen({ id }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'error' | 'ready'
  const [split, setSplit] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getSplit(id)
      .then((data) => {
        if (cancelled) return;
        setSplit(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err.message || 'This split was not found, or has expired.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const payers = split ? Object.keys(split.totals?.per_person || {}) : [];

  return (
    <section data-screen="payer" className="app-screen py-8 space-y-4">
      <h2 className="text-xl font-bold">Bill split</h2>

      {status === 'loading' && (
        <div className="text-center py-12 space-y-4">
          <div className="animate-spin mx-auto h-10 w-10 rounded-full border-4 border-amber-500 border-t-transparent" />
          <p className="text-slate-600">Loading split…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {errorMessage}
        </div>
      )}

      {status === 'ready' && split && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="font-semibold text-sm text-slate-700">Items</h3>
            <div className="space-y-1">
              {split.items.map((item) => (
                <PayerItemRow key={item.id ?? item.name} item={item} />
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="font-semibold text-sm text-slate-700">Who owes what</h3>
            <div className="text-sm space-y-2">
              {payers.map((name) => (
                <div key={name} className="flex justify-between">
                  <span>{name}</span>
                  <span className="font-semibold">{formatRM(split.totals.per_person[name])}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="font-semibold text-sm text-slate-700">Pay the bill owner</h3>
            <p className="text-sm font-mono bg-slate-50 rounded-md p-3 break-words">
              {split.ownerPaymentHandle}
            </p>
          </div>

          <p className="text-xs text-slate-400 text-center">
            Split created via Bilang, a free tool by Paeveul. Paeveul never holds or routes this
            money.
          </p>
        </div>
      )}
    </section>
  );
}
