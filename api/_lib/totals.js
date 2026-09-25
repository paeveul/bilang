// api/_lib/totals.js
//
// Single source of the money arithmetic. CommonJS so the serverless handlers
// (api/*) can require() it directly; js/totals.js re-exports it for the
// browser bundle.
//
// Deterministic per-person total computation (roadmap A5). The
// model only ever READS the receipt (js/api-client.js -> /api/parse) — this
// module is the ONLY place money is actually computed anywhere in the app,
// and it never talks to the network. Tax + service charge are apportioned
// pro-rata by each payer's share of the assigned item subtotal.
//
// All arithmetic is done in integer cents to avoid floating-point drift, with
// the largest-remainder method used to distribute leftover cents fairly
// (so per-person totals always sum exactly to the itemized total).

/** Convert a ringgit amount (number) to integer cents, rounding to the nearest cent. */
function toCents(amount) {
  return Math.round((Number(amount) || 0) * 100);
}

function fromCents(cents) {
  return Math.round(cents) / 100;
}

function formatRM(amount) {
  return `RM${Number(amount || 0).toFixed(2)}`;
}

/**
 * Formats a ringgit amount with a space between "RM" and the figure, e.g.
 * "RM 1.00" — used ONLY for the item 22 Step 8 correction-screen's locked
 * status/error strings (`bilang-round-2-design-spec.md` §5.1.1 points 3/4,
 * sourced verbatim from `bilang-direction-round-2-feedback.md`'s exact-copy
 * tables around lines 327-345, e.g. "RM 1.00 left to allocate"). Every other
 * money label in the app (item totals, running totals, etc.) keeps using
 * the existing no-space `formatRM()` above, unchanged — this is a distinct,
 * deliberately narrow formatter for Tony's locked copy, not a replacement.
 */
function formatRMLocked(amount) {
  return `RM ${Number(amount || 0).toFixed(2)}`;
}

/**
 * Resolves a percentage (0-100, may be fractional) of an item's line total
 * into integer cents — the manual-override RM/% toggle's "%" mode (§5.1.1
 * point 2/7). The result is always whole cents: this is the canonical
 * *stored* value the submit-time exact-match check reads, independent of
 * whatever's displayed on screen while a %-mode field is being typed.
 */
function percentToCents(percent, lineTotalRM) {
  const lineCents = toCents(lineTotalRM);
  const pct = Number(percent);
  if (!Number.isFinite(pct)) return 0;
  return Math.round((pct / 100) * lineCents);
}

/**
 * Inverse of percentToCents, for DISPLAY only — converting a stored cents
 * value back into a percentage string when the RM/% toggle switches to "%"
 * (§5.1.1 point 7: "rounded to one decimal place for display"). Never used
 * for the submit-time check itself; cents stay canonical there always, so a
 * display-rounding artefact here can never itself cause a false block or a
 * false pass (§5.1.1 point 7's own explicit guarantee).
 */
function centsToPercent(cents, lineTotalRM) {
  const lineCents = toCents(lineTotalRM);
  if (lineCents === 0) return 0;
  return Math.round(((Number(cents) || 0) / lineCents) * 1000) / 10; // one decimal place
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
 * @param {Object<string, string[]|{mode:'equal',equal:string[]}|{mode:'manual',amounts:Object<string,number>}>} assignments
 *   itemId -> either a plain array of payer names (equal split — the
 *   original, unchanged shape), an explicit `{mode:'equal', equal:[...]}`
 *   wrapper (same meaning, used by Item 22 Step 8's mode-tracking UI), or
 *   `{mode:'manual', amounts:{payerName: cents}}` for a per-person manual
 *   override (§5.1.1) — `amounts` values are already-resolved integer
 *   cents, never RM or a percentage; the screen resolves RM/% input to
 *   cents (via toCents/percentToCents) before it ever reaches here.
 * @param {BillTotals} billTotals
 * @param {string[]} payers - all payer names, in display order
 * @returns {{
 *   perPerson: Object<string, {itemsCents:number, taxCents:number, serviceCents:number, totalCents:number}>,
 *   itemizedSubtotalCents: number,
 *   reconciliation: {itemizedSubtotalCents:number, statedSubtotalCents:number, matches:boolean}
 * }}
 */
function computeTotals(items, assignments, billTotals, payers) {
  const perPerson = {};
  for (const name of payers) {
    perPerson[name] = { itemsCents: 0, taxCents: 0, serviceCents: 0, totalCents: 0 };
  }

  let itemizedSubtotalCents = 0;

  for (const item of items) {
    const assignment = assignments[item.id];
    const lineCents = toCents(item.line_total);

    // Manual per-person override (§5.1.1): the assignment already carries
    // explicit resolved cent amounts per person for this item, instead of
    // an equal-split roster. Recognised only by the exact
    // { mode: 'manual', amounts } shape — a plain array, or the
    // { mode: 'equal', equal: [...] } wrapper, both fall through to the
    // equal-split branch below, which is byte-for-byte the same code that
    // ran before this mode existed.
    if (assignment && !Array.isArray(assignment) && assignment.mode === 'manual') {
      const amounts = assignment.amounts || {};
      let itemSumCents = 0;
      for (const name of Object.keys(amounts)) {
        if (!perPerson[name]) continue; // ignore amounts for an unknown/removed payer
        const cents = Math.round(Number(amounts[name]) || 0);
        if (!(cents > 0)) continue; // zero/negative/NaN contributes nothing
        perPerson[name].itemsCents += cents;
        itemSumCents += cents;
      }
      // Only what was actually allocated counts toward the itemized
      // subtotal here — NOT the item's nominal line_total. An under- or
      // over-allocated manual item (still mid-entry, or a caller that
      // skipped the submit-time block) is represented honestly: the money
      // that exists in perPerson is exactly the money counted here, always.
      itemizedSubtotalCents += itemSumCents;
      continue;
    }

    // Equal-split: either the legacy plain array, or the new
    // { mode: 'equal', equal: [...] } wrapper — same list of names either
    // way, and everything from here down is unchanged from before manual
    // mode existed.
    const names = Array.isArray(assignment) ? assignment : assignment?.equal;
    const assignedTo = (names || []).filter((name) => perPerson[name]);
    if (assignedTo.length === 0) continue;

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

/**
 * For a single item's current assignment, how many cents are still
 * unallocated (positive) or over-allocated (negative) — what §5.1.1's live
 * "remaining to allocate" indicator and submit-time block both key off.
 * Equal-split items are always exactly resolved the moment at least one
 * person is ticked (the largest-remainder method guarantees this by
 * construction, above) — only a manual-mode item can carry a nonzero
 * remainder, so this returns 0 for every other assignment shape.
 *
 * `assignment.manual.values` is `{ [payerName]: { cents } }` — the shape
 * `src/state/BillContext.jsx`'s reducer maintains for the in-progress
 * editor UI (it also tracks display `text` per the active RM/% unit, which
 * this function ignores — only `cents`, the canonical stored value, ever
 * feeds this calculation, per §5.1.1 point 7).
 */
function manualItemRemainingCents(item, assignment) {
  if (!assignment || assignment.mode !== 'manual') return 0;
  const lineCents = toCents(item.line_total);
  const values = assignment.manual?.values || {};
  const allocatedCents = Object.values(values).reduce(
    (sum, v) => sum + (Math.round(Number(v?.cents)) || 0),
    0
  );
  return lineCents - allocatedCents;
}

module.exports = {
  toCents,
  fromCents,
  formatRM,
  formatRMLocked,
  percentToCents,
  centsToPercent,
  computeTotals,
  manualItemRemainingCents,
};
