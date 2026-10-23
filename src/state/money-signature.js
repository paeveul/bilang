// src/state/money-signature.js
//
// A short fingerprint of everything that can change whether a receipt adds up:
// each item's name, quantity, prices and discount, and the bill's own figures.
// Who ordered an item is not part of it, and neither is an item's category, so
// changing either leaves the fingerprint (and a host's tick) alone.

import { toCents } from '../../js/totals.js';

const BILL_MONEY_FIELDS = ['subtotal', 'service_charge', 'tax', 'discount', 'rounding', 'grand_total'];

export function moneySignature(parsed) {
  if (!parsed) return '';
  const items = (parsed.items || []).map((item) => [
    item.id,
    item.name,
    Number(item.qty),
    toCents(item.unit_price),
    toCents(item.line_total),
    toCents(item.discount),
  ]);
  const bill = BILL_MONEY_FIELDS.map((field) => toCents(parsed[field]));
  return JSON.stringify([items, bill]);
}
