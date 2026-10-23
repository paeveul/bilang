// src/screens/receipt-status.js — what the Bill totals status panel says.
// Pure (no React) so it can be tested directly. All figures come from the
// shared exact check in js/totals.js (cents, no tolerance); nothing here does
// its own arithmetic on the receipt except choosing wording.

import { billDiscountExceedsItems, reconcileReceipt, toCents } from '../../js/totals.js';
import { moneySignature } from '../state/money-signature.js';

/**
 * `options.ticked` is true when the host has ticked that the screen matches the
 * paper receipt (and the tick is still valid). A receipt that does not add up
 * then reads as 'ticked' and no longer blocks Confirm. A tick never lifts a
 * block caused by an impossible figure.
 *
 * @returns {{
 *   applicable: boolean,
 *   kind: 'none'|'ok'|'item_discount_too_big'|'item_price_invalid'|'bill_discount_too_big'|'off'|'ticked',
 *   blocked: boolean,            // Confirm must be off
 *   hardError: boolean,          // an impossible figure: no tick is offered
 *   differenceCents: number,     // grand total minus what the lines come to
 *   computedCents: number,
 *   grandTotalCents: number,
 *   direction: 'short'|'over'|null,
 *   itemName: string|null,
 *   hint: null|{ amountCents:number, target:'item'|'items'|'bill', direction:'short'|'over' }
 * }}
 */
export function computeReceiptStatus(items, parsed, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const rec = reconcileReceipt(list, parsed);
  const base = {
    applicable: rec.applicable,
    kind: 'none',
    blocked: false,
    hardError: false,
    differenceCents: rec.differenceCents,
    computedCents: rec.computedCents,
    grandTotalCents: rec.grandTotalCents,
    direction: null,
    itemName: null,
    hint: null,
  };
  // An older split / a fixture without the new fields: no exact check, no panel.
  if (!rec.applicable || list.length === 0) return base;

  const nameOf = (id) => {
    const item = list.find((i) => i.id === id);
    return item && item.name ? item.name : 'this item';
  };

  const discountError = rec.errors.find((e) => e.code === 'discount_exceeds_item');
  if (discountError) {
    return { ...base, kind: 'item_discount_too_big', blocked: true, hardError: true, itemName: nameOf(discountError.id) };
  }
  const priceError = rec.errors.find((e) => e.code === 'negative_item_line');
  if (priceError) {
    return { ...base, kind: 'item_price_invalid', blocked: true, hardError: true, itemName: nameOf(priceError.id) };
  }
  if (billDiscountExceedsItems(list, parsed)) {
    return { ...base, kind: 'bill_discount_too_big', blocked: true, hardError: true };
  }
  if (rec.differenceCents === 0) return { ...base, kind: 'ok' };

  const direction = rec.differenceCents > 0 ? 'short' : 'over';
  if (options.ticked) {
    return { ...base, kind: 'ticked', blocked: false, direction };
  }
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
  return {
    ...base,
    kind: 'off',
    blocked: true,
    direction,
    hint,
  };
}

/**
 * The difference (signed cents) the host has acknowledged, or 0. It counts only
 * while the tick is still valid: made at the current money fingerprint, at the
 * receipt's present difference, with no impossible figure on the screen.
 */
export function acknowledgedGapCents(items, parsed, gapAck) {
  if (!gapAck || !parsed) return 0;
  if (gapAck.signature !== moneySignature(parsed)) return 0;
  const status = computeReceiptStatus(items, parsed);
  if (!status.applicable || status.hardError || status.differenceCents === 0) return 0;
  return status.differenceCents === gapAck.gapCents ? status.differenceCents : 0;
}

/** The bill figures with the acknowledged difference added, for totals and the saved payload. */
export function billWithAcknowledgedGap(items, parsed, gapAck) {
  const gap = acknowledgedGapCents(items, parsed, gapAck);
  return gap === 0 ? parsed : { ...parsed, receipt_gap_cents: gap, receipt_gap_acknowledged: true };
}
