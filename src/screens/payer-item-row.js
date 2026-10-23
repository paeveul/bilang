//
// Plain .js using React.createElement rather than JSX syntax — deliberate,
// not a style choice. This lets payer-item-row.security.test.mjs import
// and render this component directly under Node's built-in test runner
// (no JSX transform available outside Vite's own dev/build pipeline, and
// this migration adds no new test-runner dependency — see that test
// file's header comment). PayerScreen.jsx (ordinary JSX) imports and uses
// this component normally; the two are functionally identical either way,
// since JSX is only syntax sugar over React.createElement.
//
import { createElement as h } from 'react';
import { formatRM } from '../../js/totals.js';
import { ItemDiscountLine, itemNetRM } from './discount-lines.js';

export function PayerItemRow({ item }) {
  return h(
    'div',
    { className: 'flex justify-between text-sm' },
    h(
      'span',
      null,
      item.name,
      h('span', { className: 'text-slate-400' }, ' ×', item.qty),
      h(ItemDiscountLine, { item })
    ),
    h('span', { className: 'shrink-0' }, formatRM(itemNetRM(item)))
  );
}

export default PayerItemRow;
