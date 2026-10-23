// src/screens/discount-lines.js — the discount and rounding lines the payer
// view shows. Plain .js with createElement (same reason as payer-item-row.js:
// directly testable under Node's runner without a JSX transform).
//
// Nothing is rendered at zero: a bill with no discount and no rounding looks
// exactly as it did before these lines existed.
import { createElement as h } from 'react';
import { formatRMLocked, fromCents, itemNetCents, toCents } from '../../js/totals.js';

/** An item's own discount in cents, zero or positive; a missing field reads as 0. */
export function itemDiscountCents(item) {
  return Math.abs(toCents(item && item.discount));
}

/** "Price RM 40.00 · Discount −RM 8.00" under an item name; null when it has no discount. */
export function ItemDiscountLine({ item }) {
  const discount = itemDiscountCents(item);
  if (discount === 0) return null;
  const price = formatRMLocked(item.line_total);
  const amount = formatRMLocked(fromCents(discount));
  return h(
    'span',
    { className: 'block text-sm text-slate-600', 'data-testid': 'item-discount-line' },
    h('span', { 'aria-hidden': 'true' }, `Price ${price} · Discount −${amount}`),
    h('span', { className: 'sr-only' }, `Price ${price}, discount minus ${amount}`)
  );
}

/** The amount an item costs after its own discount, in RM. */
export function itemNetRM(item) {
  return fromCents(itemNetCents(item));
}

function BillLine({ label, spoken, visible, testId }) {
  return h(
    'div',
    { className: 'space-y-0.5', 'data-testid': testId },
    h(
      'div',
      { className: 'flex justify-between gap-3 text-sm' },
      h('span', null, label),
      h(
        'span',
        { className: 'shrink-0 tabular-nums' },
        h('span', { 'aria-hidden': 'true' }, visible),
        h('span', { className: 'sr-only' }, spoken)
      )
    ),
    h('p', { className: 'text-xs text-slate-600' }, 'Shared by what each person ordered.')
  );
}

/**
 * The bill-level lines under the last item: "Discount" and "Rounding", each
 * only when non-zero. `totals` is the split's stored totals (old splits have
 * neither field). "(set by host)" shows only when the saved edited flag is set.
 */
export function PayerBillLines({ totals }) {
  const discount = Math.abs(toCents(totals && totals.discount));
  const rounding = toCents(totals && totals.rounding);
  if (discount === 0 && rounding === 0) return null;
  const rows = [];
  if (discount !== 0) {
    const amount = formatRMLocked(fromCents(discount));
    rows.push(
      h(BillLine, {
        key: 'discount',
        testId: 'payer-discount-line',
        label: 'Discount',
        visible: `−${amount}`,
        spoken: `Discount, minus ${amount}`,
      })
    );
  }
  if (rounding !== 0) {
    const amount = formatRMLocked(fromCents(Math.abs(rounding)));
    const edited = totals && totals.rounding_edited === true;
    rows.push(
      h(BillLine, {
        key: 'rounding',
        testId: 'payer-rounding-line',
        label: edited ? 'Rounding (set by host)' : 'Rounding',
        visible: `${rounding > 0 ? '+' : '−'}${amount}`,
        spoken: `Rounding, ${rounding > 0 ? 'plus' : 'minus'} ${amount}`,
      })
    );
  }
  return h('div', { className: 'border-t border-slate-100 pt-2 mt-2 space-y-2' }, rows);
}
