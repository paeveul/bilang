// src/screens/receipt-status.js — what the Bill totals status panel says.
// Pure (no React) so it can be tested directly. All figures come from the
// shared exact check in js/totals.js (cents, no tolerance); nothing here does
// its own arithmetic on the receipt except choosing wording.

import { billDiscountExceedsItems, reconcileReceipt, toCents } from '../../js/totals.js';

// One switch for the one-tap "Use this difference as rounding". Set it to
// false to remove the button, its lead-in line and the "too big to be
// rounding" line; nothing else changes.
export const ALLOW_USE_DIFFERENCE_AS_ROUNDING = true;

// The most the host may book as rounding in one tap (RM 0.05), counted on the
// resulting Rounding (what is already there plus the difference).
export const MAX_ROUNDING_CENTS = 5;

/**
 * @returns {{
 *   applicable: boolean,
 *   kind: 'none'|'ok'|'item_discount_too_big'|'item_price_invalid'|'bill_discount_too_big'|'off',
 *   blocked: boolean,            // Confirm must be off
 *   differenceCents: number,     // grand total minus what the lines come to
 *   computedCents: number,
 *   grandTotalCents: number,
 *   direction: 'short'|'over'|null,
 *   itemName: string|null,
 *   hint: null|{ amountCents:number, target:'item'|'items'|'bill', direction:'short'|'over' },
 *   rounding: null|{ allowed:boolean, resultingCents:number }  // only when kind is 'off'
 * }}
 */
export function computeReceiptStatus(items, parsed) {
  const list = Array.isArray(items) ? items : [];
  const rec = reconcileReceipt(list, parsed);
  const base = {
    applicable: rec.applicable,
    kind: 'none',
    blocked: false,
    differenceCents: rec.differenceCents,
    computedCents: rec.computedCents,
    grandTotalCents: rec.grandTotalCents,
    direction: null,
    itemName: null,
    hint: null,
    rounding: null,
  };
  // An older split / a fixture without the new fields: no exact check, no panel.
  if (!rec.applicable || list.length === 0) return base;

  const nameOf = (id) => {
    const item = list.find((i) => i.id === id);
    return item && item.name ? item.name : 'this item';
  };

  const discountError = rec.errors.find((e) => e.code === 'discount_exceeds_item');
  if (discountError) {
    return { ...base, kind: 'item_discount_too_big', blocked: true, itemName: nameOf(discountError.id) };
  }
  const priceError = rec.errors.find((e) => e.code === 'negative_item_line');
  if (priceError) {
    return { ...base, kind: 'item_price_invalid', blocked: true, itemName: nameOf(priceError.id) };
  }
  if (billDiscountExceedsItems(list, parsed)) {
    return { ...base, kind: 'bill_discount_too_big', blocked: true };
  }
  if (rec.differenceCents === 0) return { ...base, kind: 'ok' };

  const direction = rec.differenceCents > 0 ? 'short' : 'over';
  let hint = null;
  if (rec.hint) {
    const amount = rec.hint.amountCents;
    const itemsWith = list.filter((i) => toCents(i.discount) !== 0 && Math.abs(toCents(i.discount)) === amount);
    const billMatches = Math.abs(toCents(parsed && parsed.discount)) === amount;
    let target;
    if (itemsWith.length === 1 && !billMatches) target = 'item';
    else if (itemsWith.length === 0 && billMatches) target = 'bill';
    else target = 'items';
    hint = { amountCents: amount, target, direction };
  }
  const resultingCents = toCents(parsed && parsed.rounding) + rec.differenceCents;
  return {
    ...base,
    kind: 'off',
    blocked: true,
    direction,
    hint,
    rounding: { allowed: Math.abs(resultingCents) <= MAX_ROUNDING_CENTS, resultingCents },
  };
}
