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

/** A discount in cents, always zero or positive. A printed negative is stored as a positive discount. */
function discountCentsOf(value) {
  return Math.abs(toCents(value));
}

/**
 * What an item costs after its own discount, in cents. `line_total` is the
 * gross price as printed; `discount` is the amount taken off THIS item. A
 * missing discount reads as 0, so an old item gives back its line total.
 * Never below zero (a discount larger than its item is refused by
 * reconcileReceipt, and cannot make a negative line here).
 */
function itemNetCents(item) {
  return Math.max(0, toCents(item.line_total) - discountCentsOf(item.discount));
}

/**
 * The acknowledged difference on the receipt, in signed cents, or 0.
 *
 * The difference is grand total minus what the printed lines add up to. It is
 * shared like service and tax only when the bill carries the host's tick
 * (`receipt_gap_acknowledged: true`) and a whole-cent `receipt_gap_cents`. A
 * split saved before this existed has neither field and reads as 0.
 */
function receiptGapCentsOf(billTotals) {
  const t = billTotals || {};
  if (t.receipt_gap_acknowledged !== true) return 0;
  return Number.isInteger(t.receipt_gap_cents) ? t.receipt_gap_cents : 0;
}

/**
 * Splits a signed amount (cents) across weights with the largest-remainder
 * method: every part is within 1 cent of the exact proportion, the parts add
 * to the amount exactly, and a weight of 0 never receives a cent. When every
 * weight is 0 the whole amount goes to the LAST slot (the unclaimed slot).
 */
function allocateByWeight(amount, weights) {
  const out = weights.map(() => 0);
  if (amount === 0 || weights.length === 0) return out;
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    out[out.length - 1] = amount;
    return out;
  }
  const abs = Math.abs(amount);
  const sign = amount < 0 ? -1 : 1;
  const remainders = [];
  let used = 0;
  weights.forEach((w, i) => {
    const numerator = abs * w;
    out[i] = Math.floor(numerator / total);
    remainders.push(numerator - out[i] * total);
    used += out[i];
  });
  const order = weights.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (let k = 0; k < abs - used; k += 1) out[order[k]] += 1;
  return out.map((v) => (v === 0 ? 0 : v * sign));
}

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} name
 * @property {string} category
 * @property {number} qty
 * @property {number} unit_price
 * @property {number} line_total - gross price as printed, before any item discount
 * @property {number} [discount] - discount against THIS item (default 0)
 *
 * @typedef {object} BillTotals
 * @property {number} subtotal
 * @property {number} service_charge
 * @property {number} tax
 * @property {number} grand_total
 * @property {number} [discount] - bill-level discount, positive (default 0)
 * @property {number} [rounding] - signed rounding line as printed (default 0)
 * @property {number} [receipt_gap_cents] - signed difference on the receipt, used only with receipt_gap_acknowledged
 * @property {boolean} [receipt_gap_acknowledged] - the host ticked that the screen matches the paper
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
 *   perPerson: Object<string, {itemsCents:number, taxCents:number, serviceCents:number, [discountCents]:number, [roundingCents]:number, totalCents:number}>,
 *   itemizedSubtotalCents: number,
 *   unclaimed: {itemsCents:number, taxCents:number, serviceCents:number, [discountCents]:number, [roundingCents]:number, totalCents:number} (bracketed keys exist only when the bill has a discount or rounding; read them as 0 otherwise),
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
    accounts.set(name, {
      itemsCents: 0,
      taxCents: 0,
      serviceCents: 0,
      totalCents: 0,
    });
  }

  let itemizedSubtotalCents = 0;
  let unclaimedItemsCents = 0;

  for (const item of items) {
    const assignment = hasOwn(assignments, item.id) ? assignments[item.id] : undefined;
    // Net of the item's own discount: this is what gets split and what weighs
    // in the bill-line shares. With no discount it is the line total, as before.
    const lineCents = itemNetCents(item);

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
  const billDiscountCents = discountCentsOf(billTotals.discount);
  const billRoundingCents = toCents(billTotals.rounding);
  const billGapCents = receiptGapCentsOf(billTotals);

  let unclaimedTaxCents = 0;
  let unclaimedServiceCents = 0;
  let unclaimedDiscountCents = 0;
  let unclaimedRoundingCents = 0;
  let unclaimedGapCents = 0;

  // When every item is fully discounted (nothing to weigh by) and the bill
  // still prints service or tax, the original arithmetic has no one to give
  // them to and would drop them. Those bills take the allocator below, which
  // sends the whole amount to the unclaimed slot.
  const nothingToWeigh =
    itemizedSubtotalCents + unclaimedItemsCents === 0 && (billTaxCents !== 0 || billServiceCents !== 0);

  // Any discount (on an item or the whole bill), rounding or acknowledged
  // receipt difference sends the bill through the largest-remainder
  // allocator, so every person's share of every bill line is within 1 cent of
  // exact. Only a bill with none of them keeps the original arithmetic.
  const hasItemDiscount = items.some((item) => discountCentsOf(item.discount) > 0);
  const useAllocator = billDiscountCents !== 0 || billRoundingCents !== 0 || billGapCents !== 0 || hasItemDiscount || nothingToWeigh;

  if (!useAllocator) {
    // No discount of any kind and no rounding: the original tax / service
    // arithmetic, unchanged, so a bill without them gives exactly the figures
    // it always did.
    //
    // Tax and service are computed only on claimed items. When some items are
    // unclaimed, the bill's tax and service are first divided between the claimed
    // and the unclaimed items by their share of the itemized amount; only the
    // claimed part is charged to people. With nothing unclaimed the whole amount
    // goes to the claimed items, exactly as before.
    let taxCents = billTaxCents;
    let serviceCents = billServiceCents;
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
  } else {
    // A discount or a rounding line is present. Weights are each
    // person's net item cents; unclaimed items carry weight too (last slot).
    // Every bill line is split by the largest-remainder method, so each
    // person's share of each line is within 1 cent of exact, the shares plus
    // the unclaimed part add to the line exactly, and someone with weight 0
    // gets nothing. Rounding is spread by weight, never added on top.
    const weights = payers.map((n) => accounts.get(n).itemsCents);
    weights.push(unclaimedItemsCents);
    const discountShares = allocateByWeight(billDiscountCents, weights);
    const serviceShares = allocateByWeight(billServiceCents, weights);
    const taxShares = allocateByWeight(billTaxCents, weights);
    const roundingShares = allocateByWeight(billRoundingCents, weights);
    const gapShares = allocateByWeight(billGapCents, weights);
    payers.forEach((name, i) => {
      const p = accounts.get(name);
      p.discountCents = discountShares[i];
      p.serviceCents = serviceShares[i];
      p.taxCents = taxShares[i];
      p.roundingCents = roundingShares[i];
      if (billGapCents !== 0) p.gapCents = gapShares[i];
    });
    const last = weights.length - 1;
    unclaimedDiscountCents = discountShares[last];
    unclaimedServiceCents = serviceShares[last];
    unclaimedTaxCents = taxShares[last];
    unclaimedRoundingCents = roundingShares[last];
    unclaimedGapCents = gapShares[last];
  }

  const perPerson = {};
  for (const name of payers) {
    const p = accounts.get(name);
    p.totalCents =
      p.itemsCents + p.taxCents + p.serviceCents + (p.roundingCents || 0) + (p.gapCents || 0) - (p.discountCents || 0);
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
      // Present only when the bill has a discount or rounding, so a bill
      // without them reports the same unclaimed figures, same shape, as before.
      ...(useAllocator
        ? { discountCents: unclaimedDiscountCents, roundingCents: unclaimedRoundingCents }
        : {}),
      // Present only when the bill carries an acknowledged difference.
      ...(billGapCents !== 0 ? { gapCents: unclaimedGapCents } : {}),
      totalCents:
        unclaimedItemsCents +
        unclaimedTaxCents +
        unclaimedServiceCents +
        unclaimedRoundingCents +
        unclaimedGapCents -
        unclaimedDiscountCents,
    },
    reconciliation: {
      itemizedSubtotalCents,
      statedSubtotalCents,
      // Item-sum vs stated subtotal, kept for older callers. The check that
      // decides whether a bill adds up to the receipt is reconcileReceipt().
      matches: Math.abs(itemizedSubtotalCents - statedSubtotalCents) < 2,
    },
  };
}

/**
 * True when the receipt carries any of the discount / rounding fields (an item
 * `discount`, a bill `discount`, or `rounding`). A split saved before those
 * fields existed has none of them, so the exact check does not apply to it.
 */
function hasDiscountFields(items, billTotals) {
  const t = billTotals || {};
  return (
    t.discount !== undefined ||
    t.rounding !== undefined ||
    (Array.isArray(items) && items.some((item) => item && item.discount !== undefined))
  );
}

/**
 * The exact receipt check, in integer cents, no tolerance:
 *
 *   sum(line_total - item discount) - discount + service_charge + tax + rounding = grand_total
 *
 * `subtotal` is not part of it. Negative discounts are read as positive.
 * `differenceCents` is grand_total minus what the lines add up to: positive
 * means the receipt prints more than the lines explain. It is only reported.
 * The app never adds it to the rounding, a discount or any printed figure; a
 * non-zero difference passes only with the host's acknowledgement, and is then
 * shared as its own "Difference on receipt" line.
 *
 * @returns {{
 *   applicable: boolean,      // false for a split saved before these fields existed
 *   matches: boolean,         // differenceCents === 0 and no errors
 *   computedCents: number,
 *   grandTotalCents: number,
 *   differenceCents: number,
 *   errors: Array<{code:'discount_exceeds_item'|'negative_item_line'|'bill_discount_exceeds_items', index:number, id:*}>,
 *   hint: null | {code:'discount_mismatch', amountCents:number, multiple:1|2}
 * }}
 */
function reconcileReceipt(items, billTotals) {
  const t = billTotals || {};
  const list = Array.isArray(items) ? items : [];
  const errors = [];
  const discountAmounts = [];
  let itemsNetCents = 0;
  list.forEach((item, index) => {
    const lineCents = toCents(item.line_total);
    const discCents = discountCentsOf(item.discount);
    if (lineCents < 0) errors.push({ code: 'negative_item_line', index, id: item.id });
    else if (discCents > lineCents) errors.push({ code: 'discount_exceeds_item', index, id: item.id });
    if (discCents > 0) discountAmounts.push(discCents);
    itemsNetCents += lineCents - discCents;
  });
  const billDiscountCents = discountCentsOf(t.discount);
  if (billDiscountCents > 0) discountAmounts.push(billDiscountCents);
  // A voucher cannot exceed what was ordered. Equal to the items total is fine.
  if (billDiscountExceedsItems(list, t)) errors.push({ code: 'bill_discount_exceeds_items', index: -1, id: null });

  const computedCents =
    itemsNetCents - billDiscountCents + toCents(t.service_charge) + toCents(t.tax) + toCents(t.rounding);
  const grandTotalCents = toCents(t.grand_total);
  const differenceCents = grandTotalCents - computedCents;

  // Off by exactly one discount amount (or its double): the usual sign of a
  // discount counted twice, or counted when the line already showed the net.
  let hint = null;
  if (differenceCents !== 0) {
    for (const amountCents of discountAmounts) {
      if (Math.abs(differenceCents) === amountCents) {
        hint = { code: 'discount_mismatch', amountCents, multiple: 1 };
        break;
      }
      if (Math.abs(differenceCents) === 2 * amountCents) {
        hint = { code: 'discount_mismatch', amountCents, multiple: 2 };
        break;
      }
    }
  }

  return {
    applicable: hasDiscountFields(items, billTotals),
    matches: differenceCents === 0 && errors.length === 0,
    computedCents,
    grandTotalCents,
    differenceCents,
    errors,
    hint,
  };
}

/**
 * True when the bill-level discount is more than what the items cost after
 * their own discounts. A voucher cannot exceed what was ordered, so this is a
 * misread or a double count. Equal is allowed.
 */
function billDiscountExceedsItems(items, billTotals) {
  const list = Array.isArray(items) ? items : [];
  const itemsNetCents = list.reduce((sum, item) => sum + itemNetCents(item), 0);
  return discountCentsOf((billTotals || {}).discount) > itemsNetCents;
}

/**
 * Tidies a scan result so the maths only ever sees clean figures:
 *  - a missing item `discount`, bill `discount` or `rounding` becomes 0;
 *  - a printed negative discount becomes a positive one;
 *  - an item line with a negative amount is a discount line that was read as
 *    an item: it is removed and its amount added to the bill-level discount
 *    (its position is unclear, so bill level);
 *  - `rounding` keeps its sign. Nothing is ever invented.
 * Returns a new object; the input is not changed.
 */
function normalizeScanDiscounts(parsed) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return parsed;
  let billDiscountCents = discountCentsOf(parsed.discount);
  const items = [];
  for (const item of parsed.items) {
    if (!item || typeof item !== 'object') {
      items.push(item);
      continue;
    }
    if (Number.isFinite(item.line_total) && item.line_total < 0) {
      billDiscountCents += Math.abs(toCents(item.line_total));
      continue;
    }
    items.push({ ...item, discount: fromCents(discountCentsOf(item.discount)) });
  }
  return {
    ...parsed,
    items,
    discount: fromCents(billDiscountCents),
    rounding: Number.isFinite(parsed.rounding) ? parsed.rounding : 0,
  };
}

/**
 * A finite, non-negative number as an exact decimal: `{ digits, scale }` where
 * the value is digits / 10^scale, with digits a BigInt. Uses the shortest
 * decimal text of the number (what the host typed), so 1.005 is exactly
 * 1005 / 1000 and never the nearest binary fraction.
 */
function exactDecimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) return null;
  const fraction = match[2] || '';
  let digits = BigInt(match[1] + fraction);
  let scale = fraction.length - (match[3] ? Number(match[3]) : 0);
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { digits, scale };
}

/**
 * The line price, in whole sen, for a host's edit of quantity or unit price:
 * quantity x unit price, computed once in exact decimal arithmetic and rounded
 * half up to the nearest sen. Quantity and unit price themselves are never
 * rounded. Floating-point noise cannot flip a true half (1.005 x RM 1.00 is
 * exactly 100.5 sen and settles to 101).
 *
 * Returns `{ cents, rounded }` (`rounded` is true when the exact product was
 * not already a whole sen), or null when there is nothing to calculate: a
 * quantity that is not above zero, a unit price that is not a number of zero
 * or more, or a product too large to hold exactly.
 */
function lineTotalFromQty(qty, unitPrice) {
  const q = exactDecimal(qty);
  const u = exactDecimal(unitPrice);
  if (!q || !u || q.digits === 0n) return null;
  const numerator = q.digits * u.digits * 100n;
  const denominator = 10n ** BigInt(q.scale + u.scale);
  const whole = numerator / denominator;
  const remainder = numerator - whole * denominator;
  const roundedUp = remainder * 2n >= denominator;
  const cents = Number(roundedUp ? whole + 1n : whole);
  if (!Number.isSafeInteger(cents)) return null;
  return { cents, rounded: remainder !== 0n };
}

function manualItemRemainingCents(item, assignment) {
  if (!assignment || assignment.mode !== 'manual') return 0;
  const lineCents = itemNetCents(item);
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
  itemNetCents,
  hasDiscountFields,
  reconcileReceipt,
  receiptGapCentsOf,
  lineTotalFromQty,
  billDiscountExceedsItems,
  normalizeScanDiscounts,
};
