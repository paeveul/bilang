// js/totals.js
//
// Deterministic, client-side, per-person total computation (roadmap A5). The
// model only ever READS the receipt (js/api-client.js -> /api/parse) — this
// module is the ONLY place money is actually computed anywhere in the app,
// and it never talks to the network. Tax + service charge are apportioned
// pro-rata by each payer's share of the assigned item subtotal.
//
// All arithmetic is done in integer cents to avoid floating-point drift, with
// the largest-remainder method used to distribute leftover cents fairly
// (so per-person totals always sum exactly to the itemized total).

/** Convert a ringgit amount (number) to integer cents, rounding to the nearest cent. */
export function toCents(amount) {
  return Math.round((Number(amount) || 0) * 100);
}

export function fromCents(cents) {
  return Math.round(cents) / 100;
}

export function formatRM(amount) {
  return `RM${Number(amount || 0).toFixed(2)}`;
}

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {number} qty
 * @property {number} unit_price
 * @property {number} line_total
 *
 * @typedef {object} BillTotals
 * @property {number} subtotal
 * @property {number} service_charge
 * @property {number} tax
 * @property {number} grand_total
 *
 * @param {Item[]} items
 * @param {Object<string, string[]>} assignments - itemId -> array of payer names assigned to it
 * @param {BillTotals} billTotals
 * @param {string[]} payers - all payer names, in display order
 * @returns {{
 *   perPerson: Object<string, {itemsCents:number, taxCents:number, serviceCents:number, totalCents:number}>,
 *   itemizedSubtotalCents: number,
 *   reconciliation: {itemizedSubtotalCents:number, statedSubtotalCents:number, matches:boolean}
 * }}
 */
export function computeTotals(items, assignments, billTotals, payers) {
  const perPerson = {};
  for (const name of payers) {
    perPerson[name] = { itemsCents: 0, taxCents: 0, serviceCents: 0, totalCents: 0 };
  }

  let itemizedSubtotalCents = 0;

  for (const item of items) {
    const assignedTo = (assignments[item.id] || []).filter((name) => perPerson[name]);
    if (assignedTo.length === 0) continue;

    const lineCents = toCents(item.line_total);
    itemizedSubtotalCents += lineCents;

    // Largest-remainder method: split the line cost evenly, then hand the
    // leftover 1-cent remainders to the first N payers so the split's total
    // exactly equals lineCents (no cent lost or invented).
    const share = Math.floor(lineCents / assignedTo.length);
    let remainder = lineCents - share * assignedTo.length;
    assignedTo.forEach((name) => {
      let cents = share;
      if (remainder > 0) {
        cents += 1;
        remainder -= 1;
      }
      perPerson[name].itemsCents += cents;
    });
  }

  const taxCents = toCents(billTotals.tax);
  const serviceCents = toCents(billTotals.service_charge);

  if (itemizedSubtotalCents > 0) {
    // Apportion tax + service charge pro-rata by each payer's share of the
    // ACTUAL itemized subtotal assigned to them — not the receipt's own
    // stated subtotal field — so the math stays internally consistent even
    // if the item review step left a small mismatch against that field.
    let taxRemaining = taxCents;
    let serviceRemaining = serviceCents;
    const namesWithItems = payers.filter((n) => perPerson[n].itemsCents > 0);

    namesWithItems.forEach((name, idx) => {
      const isLast = idx === namesWithItems.length - 1;
      const p = perPerson[name];
      const shareRatio = p.itemsCents / itemizedSubtotalCents;

      const taxShare = isLast ? taxRemaining : Math.round(taxCents * shareRatio);
      const serviceShare = isLast ? serviceRemaining : Math.round(serviceCents * shareRatio);

      p.taxCents = taxShare;
      p.serviceCents = serviceShare;
      taxRemaining -= taxShare;
      serviceRemaining -= serviceShare;
    });
  }

  for (const name of payers) {
    const p = perPerson[name];
    p.totalCents = p.itemsCents + p.taxCents + p.serviceCents;
  }

  const statedSubtotalCents = toCents(billTotals.subtotal);

  return {
    perPerson,
    itemizedSubtotalCents,
    reconciliation: {
      itemizedSubtotalCents,
      statedSubtotalCents,
      // Allow a small rounding tolerance (1 cent) before flagging a mismatch.
      matches: Math.abs(itemizedSubtotalCents - statedSubtotalCents) < 2,
    },
  };
}
