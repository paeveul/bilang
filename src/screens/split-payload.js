// src/screens/split-payload.js — builds the POST /api/split request body.
// `payers` is the ordered list of payer names; the server recomputes
// totals.per_person from items + assignments + payers and stores its own
// figures, so the per_person sent here is a preview the server checks.

import { computeTotals } from '../../js/totals.js';
import { rekeyAssignments } from '../state/bill-reducer.js';
import { cleanName } from './roster-validation.js';

export function buildSplitPayload({ parsed, payers: rawPayers, assignments: rawAssignments, ownerPaymentHandle }) {
  // What the host saw is what is stored: trimmed, single spaces, no hidden
  // characters. Assignments are re-keyed to the cleaned spelling so they
  // still match the roster.
  const payers = rawPayers.map(cleanName);
  const renames = {};
  rawPayers.forEach((name, i) => {
    if (name !== payers[i]) renames[name] = payers[i];
  });
  const assignments = Object.keys(renames).length ? rekeyAssignments(rawAssignments, renames) : rawAssignments;
  const { perPerson } = computeTotals(parsed.items, assignments, parsed, payers);
  return {
    items: parsed.items,
    assignments,
    payers,
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
    merchantName: parsed.merchant_name,
    receiptDate: parsed.receipt_date,
  };
}
