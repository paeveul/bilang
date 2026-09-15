// src/screens/payer-item-row.security.test.mjs — Item 22 Step 6's kept
// security test (22.4 Step 6 / 22.6 point 2: "This test must exist and
// must be kept," "not a one-off manual check").
//
// Run via: node --test src/screens/payer-item-row.security.test.mjs
// (added to package.json's "test" script in this pass — see that diff).
//
// No new dependency: react-dom/server's renderToStaticMarkup is already
// available transitively through the react-dom dependency Step 1 added,
// and this file imports payer-item-row.js directly (plain
// React.createElement, not JSX — see that file's header comment for why
// that avoids needing a JSX transform under Node's own test runner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { PayerItemRow } from './payer-item-row.js';

test('item.qty containing an HTML injection payload renders as visible text, not markup', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const item = { id: 'item-1', name: 'Nasi Lemak', qty: payload, line_total: 12.5 };

  const html = renderToStaticMarkup(h(PayerItemRow, { item }));

  // The payload must appear ESCAPED (as literal text) in the output...
  assert.ok(
    html.includes('&lt;img src=x onerror=alert(1)&gt;'),
    'expected the qty payload to appear as escaped, visible text in the rendered HTML'
  );
  // ...and must never appear as a real, unescaped <img> tag — which is
  // what would let the onerror handler actually execute in a browser.
  assert.ok(!html.includes('<img src=x'), 'the payload must never render as a real <img> element');
  assert.ok(!/<script/i.test(html), 'no <script> tag may ever appear in payer-view output');
});

test('a well-behaved numeric qty still renders normally', () => {
  const item = { id: 'item-2', name: 'Teh Tarik', qty: 3, line_total: 7.5 };
  const html = renderToStaticMarkup(h(PayerItemRow, { item }));
  assert.ok(html.includes('Teh Tarik'));
  assert.ok(html.includes('×3'));
  assert.ok(html.includes('RM7.50'));
});

test('item.name is also escaped by construction (same rendering path)', () => {
  const item = { id: 'item-3', name: '<b>Bold</b> Fried Rice', qty: 1, line_total: 9 };
  const html = renderToStaticMarkup(h(PayerItemRow, { item }));
  assert.ok(html.includes('&lt;b&gt;Bold&lt;/b&gt; Fried Rice'));
  assert.ok(!html.includes('<b>Bold</b>'));
});
