// api/_lib/totals.js
//
// Single source of the money arithmetic. CommonJS so the serverless handlers
// (api/*) can require() it directly; js/totals.js re-exports it for the
// browser bundle.
//
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

function formatRMLocked(amount) {
  return `RM ${Number(amount || 0).toFixed(2)}`;
}

function percentToCents(percent, lineTotalRM) {
  const lineCents = toCents(lineTotalRM);
  const pct = Number(percent);
  if (!Number.isFinite(pct)) return 0;
  return Math.round((pct / 100) * lineCents);
}

function centsToPercent(cents, lineTotalRM) {
  const lineCents = toCents(lineTotalRM);
  if (lineCents === 0) return 0;
  return Math.round(((Number(cents) || 0) / lineCents) * 1000) / 10; // one decimal place
}

/**
 * Per-person cents for a manual assignment. Accepts the explicit
 * `{mode:'manual', amounts:{name: cents}}` shape, or the app's stored state
 * shape `{mode:'manual', manual:{values:{name:{cents}}}}` that the reducer
 * builds and the server stores.
 */
function manualAmountsOf(assignment) {
  if (assignment.amounts) return assignment.amounts;
  const values = (assignment.manual && assignment.manual.values) || {};
  // No prototype, so a stored key such as "__proto__" stays an ordinary entry.
  const amounts = Object.create(null);
  for (const name of Object.keys(values)) {
    amounts[name] = values[name] && values[name].cents;
  }
  return amounts;
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

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
 *   wrapper (same meaning, used by the review screen's mode tracking), or
 *   `{mode:'manual', amounts:{payerName: cents}}` for a per-person manual
 *   override — `amounts` values are already-resolved integer
 *   cents, never RM or a percentage; the screen resolves RM/% input to
 *   cents (via toCents/percentToCents) before it ever reaches here.
 * @param {BillTotals} billTotals
 * @param {string[]} payers - all payer names, in display order
 * @returns {{
 *   perPerson: Object<string, {itemsCents:number, taxCents:number, serviceCents:number, totalCents:number}>,
 *   itemizedSubtotalCents: number,
 *   unclaimed: {itemsCents:number, taxCents:number, serviceCents:number, totalCents:number},
 *   reconciliation: {itemizedSubtotalCents:number, statedSubtotalCents:number, matches:boolean}
 * }}
 */
function computeTotals(items, assignments, billTotals, payers) {
  // Per-person accumulators live in a Map, so lookups are by exact roster name
  // only: a name that happens to match an Object.prototype key (constructor,
  // toString, __proto__) is simply not a payer, and nothing is ever written
  // onto a shared global. The returned perPerson is a plain object of the same
  // shape as before, built from the same accumulators.
  const accounts = new Map();
  for (const name of payers) {
    accounts.set(name, { itemsCents: 0, taxCents: 0, serviceCents: 0, totalCents: 0 });
  }

  let itemizedSubtotalCents = 0;
  let unclaimedItemsCents = 0;

  for (const item of items) {
    const assignment = hasOwn(assignments, item.id) ? assignments[item.id] : undefined;
    const lineCents = toCents(item.line_total);

    if (assignment && !Array.isArray(assignment) && assignment.mode === 'manual') {
      const amounts = manualAmountsOf(assignment);
      let itemSumCents = 0;
      for (const name of Object.keys(amounts)) {
        if (!accounts.has(name)) continue; // ignore amounts for an unknown/removed payer
        const cents = Math.round(Number(amounts[name]) || 0);
        if (!(cents > 0)) continue; // zero/negative/NaN contributes nothing
        accounts.get(name).itemsCents += cents;
        itemSumCents += cents;
      }
      // Only what was actually allocated counts toward the itemized
      // subtotal here — NOT the item's nominal line_total. An under- or
      // over-allocated manual item (still mid-entry, or a caller that
      // skipped the submit-time block) is represented honestly: the money
      // that exists in perPerson is exactly the money counted here, always.
      itemizedSubtotalCents += itemSumCents;
      // A dish is unclaimed only if it has no allocation at all. The leftover
      // on a partly allocated dish is neither charged nor counted as unclaimed.
      if (itemSumCents === 0) unclaimedItemsCents += lineCents;
      continue;
    }

    // Equal-split: either the legacy plain array, or the new
    // { mode: 'equal', equal: [...] } wrapper — same list of names either
    // way, and everything from here down is unchanged from before manual
    // mode existed.
    const names = Array.isArray(assignment) ? assignment : assignment?.equal;
    const assignedTo = (names || []).filter((name) => accounts.has(name));
    if (assignedTo.length === 0) {
      unclaimedItemsCents += lineCents;
      continue;
    }

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
      accounts.get(name).itemsCents += cents;
    });
  }

  const billTaxCents = toCents(billTotals.tax);
  const billServiceCents = toCents(billTotals.service_charge);

  // Tax and service are computed only on claimed items. When some items are
  // unclaimed, the bill's tax and service are first divided between the claimed
  // and the unclaimed items by their share of the itemized amount; only the
  // claimed part is charged to people. With nothing unclaimed the whole amount
  // goes to the claimed items, exactly as before.
  let taxCents = billTaxCents;
  let serviceCents = billServiceCents;
  let unclaimedTaxCents = 0;
  let unclaimedServiceCents = 0;
  if (unclaimedItemsCents > 0) {
    const basisCents = itemizedSubtotalCents + unclaimedItemsCents;
    taxCents = itemizedSubtotalCents > 0 ? Math.round((billTaxCents * itemizedSubtotalCents) / basisCents) : 0;
    serviceCents =
      itemizedSubtotalCents > 0 ? Math.round((billServiceCents * itemizedSubtotalCents) / basisCents) : 0;
    unclaimedTaxCents = billTaxCents - taxCents;
    unclaimedServiceCents = billServiceCents - serviceCents;
  }

  if (itemizedSubtotalCents > 0) {
    // Apportion tax + service charge pro-rata by each payer's share of the
    // ACTUAL itemized subtotal assigned to them — not the receipt's own
    // stated subtotal field — so the math stays internally consistent even
    // if the item review step left a small mismatch against that field.
    let taxRemaining = taxCents;
    let serviceRemaining = serviceCents;
    const namesWithItems = payers.filter((n) => accounts.get(n).itemsCents > 0);

    namesWithItems.forEach((name, idx) => {
      const isLast = idx === namesWithItems.length - 1;
      const p = accounts.get(name);
      const shareRatio = p.itemsCents / itemizedSubtotalCents;

      const taxShare = isLast ? taxRemaining : Math.round(taxCents * shareRatio);
      const serviceShare = isLast ? serviceRemaining : Math.round(serviceCents * shareRatio);

      p.taxCents = taxShare;
      p.serviceCents = serviceShare;
      taxRemaining -= taxShare;
      serviceRemaining -= serviceShare;
    });
  }

  const perPerson = {};
  for (const name of payers) {
    const p = accounts.get(name);
    p.totalCents = p.itemsCents + p.taxCents + p.serviceCents;
    // defineProperty, not assignment, so even a "__proto__" name is stored as
    // an own key rather than changing the object's prototype.
    Object.defineProperty(perPerson, name, { value: p, enumerable: true, writable: true, configurable: true });
  }

  const statedSubtotalCents = toCents(billTotals.subtotal);

  return {
    perPerson,
    itemizedSubtotalCents,
    unclaimed: {
      itemsCents: unclaimedItemsCents,
      taxCents: unclaimedTaxCents,
      serviceCents: unclaimedServiceCents,
      totalCents: unclaimedItemsCents + unclaimedTaxCents + unclaimedServiceCents,
    },
    reconciliation: {
      itemizedSubtotalCents,
      statedSubtotalCents,
      // Allow a small rounding tolerance (1 cent) before flagging a mismatch.
      matches: Math.abs(itemizedSubtotalCents - statedSubtotalCents) < 2,
    },
  };
}

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
