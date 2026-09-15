// src/screens/payer-item-row.js — Item 22 Step 6: the security-fix component.
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
// THE SECURITY FIX (F10, 22.3, 22.4 Step 6): item.qty is untrusted data —
// it comes from a stored split record, not from a value this client ever
// validated. The vanilla client (js/app.js's renderPayerView) coerced qty
// through Number() before use, which incidentally avoided the injection
// case but for the wrong reason (a happy accident of the coercion, not a
// deliberate escaping guarantee) and never rendered a non-numeric qty at
// all. Here, item.qty is rendered as an ordinary React child — React
// escapes every child value by construction, unconditionally, regardless
// of whether it looks numeric — so this is safe *by construction*, not by
// convention. dangerouslySetInnerHTML is never used anywhere in this file
// or this component tree (F10 — banned outright, verified by the
// `grep -rn dangerouslySetInnerHTML` check in 22.6).
import { createElement as h } from 'react';
import { formatRM } from '../../js/totals.js';

export function PayerItemRow({ item }) {
  return h(
    'div',
    { className: 'flex justify-between text-sm' },
    h('span', null, item.name, h('span', { className: 'text-slate-400' }, ' ×', item.qty)),
    h('span', null, formatRM(item.line_total))
  );
}

export default PayerItemRow;
