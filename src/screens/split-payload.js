// src/screens/split-payload.js — builds the POST /api/split request body.
// `payers` is the ordered list of payer names; the server recomputes
// totals.per_person from items + assignments + payers and stores its own
// figures, so the per_person sent here is a preview the server checks.

import { computeTotals } from '../../js/totals.js';

export function buildSplitPayload({ parsed, payers, assignments, ownerPaymentHandle }) {
  const { perPerson } = computeTotals(parsed.items, assignments, parsed, payers);
  return {
    items: parsed.items,
    assignments,
    payers: [...payers],
    totals: {
      subtotal: parsed.subtotal,
      service_charge: parsed.service_charge,
      tax: parsed.tax,
      grand_total: parsed.grand_total,
      per_person: Object.fromEntries(
        Object.entries(perPerson).map(([name, p]) => [name, Math.round(p.totalCents) / 100])
      ),
    },
    ownerPaymentHandle,
    // Item 23, D4: round-tripped exactly as api/parse.js returned them (via
    // `parsed`, threaded through SET_PARSED with no reducer transformation —
    // see ReviewScreen.jsx's header comment). undefined stays undefined (no
    // opinion — a legacy/never-parsed bill), matching createSplit()'s own
    // undefined-means-"omit the column" convention in api/_lib/supabase.js.
    merchantName: parsed.merchant_name,
    receiptDate: parsed.receipt_date,
  };
}
