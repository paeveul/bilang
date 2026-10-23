// src/screens/split-payload.js — builds the POST /api/split request body.
// `payers` is the ordered list of payer names; the server recomputes
// totals.per_person from items + assignments + payers and stores its own
// figures, so the per_person sent here is a preview the server checks.

import { computeTotals, toCents } from '../../js/totals.js';
import { rekeyAssignments } from '../state/bill-reducer.js';
import { cleanName } from './roster-validation.js';
import { acknowledgedGapCents, billWithAcknowledgedGap } from './receipt-status.js';

export function buildSplitPayload({ parsed, payers: rawPayers, assignments: rawAssignments, ownerPaymentHandle, gapAck = null }) {
  // What the host saw is what is stored: trimmed, single spaces, no hidden
  // characters. Assignments are re-keyed to the cleaned spelling so they
  // still match the roster.
  const payers = rawPayers.map(cleanName);
  const renames = {};
  rawPayers.forEach((name, i) => {
    if (name !== payers[i]) renames[name] = payers[i];
  });
  const assignments = Object.keys(renames).length ? rekeyAssignments(rawAssignments, renames) : rawAssignments;
  // A difference on the receipt is sent (and shared) only while the host's
  // tick is valid, so the totals sent here match what the Review screen showed.
  const gapCents = acknowledgedGapCents(parsed.items, parsed, gapAck);
  const { perPerson } = computeTotals(parsed.items, assignments, billWithAcknowledgedGap(parsed.items, parsed, gapAck), payers);
  // Bill discount and rounding are sent only when the receipt carries them (an
  // older shape sends neither, and reads as 0 on the server). The saved edited
  // flag is true only for a scanned split where the host changed the rounding.
  const roundingEdited =
    parsed.scanned_rounding !== undefined && toCents(parsed.rounding) !== toCents(parsed.scanned_rounding);
  return {
    items: parsed.items,
    assignments,
    payers,
    totals: {
      subtotal: parsed.subtotal,
      service_charge: parsed.service_charge,
      tax: parsed.tax,
      grand_total: parsed.grand_total,
      ...(parsed.discount !== undefined ? { discount: Math.abs(parsed.discount) } : {}),
      ...(parsed.rounding !== undefined ? { rounding: parsed.rounding } : {}),
      ...(roundingEdited ? { rounding_edited: true } : {}),
      ...(gapCents !== 0 ? { receipt_gap_cents: gapCents, receipt_gap_acknowledged: true } : {}),
      per_person: Object.fromEntries(
        Object.entries(perPerson).map(([name, p]) => [name, Math.round(p.totalCents) / 100])
      ),
    },
    ownerPaymentHandle,
    merchantName: parsed.merchant_name,
    receiptDate: parsed.receipt_date,
  };
}
