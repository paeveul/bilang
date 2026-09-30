// src/screens/ReviewScreen.item23.test.jsx — Item 23 Step 4: the
// correction-screen header. §5.1 point 1 / D5/D6: merchant name renders as a
// prominent heading above "Check the items", receipt date as a caption
// beneath it, both read-only, and each line simply absent (not a
// placeholder) when the underlying value is null.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.item23.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import { useEffect } from 'react';
import { BillProvider, useBillActions } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';

const item = { name: 'Teh Tarik', category: 'drink', qty: 1, unit_price: 5, line_total: 5 };

function renderWith(parsedOverrides = {}) {
  function Harness() {
    const { setParsed } = useBillActions();
    useEffect(() => {
      setParsed({
        items: [item],
        subtotal: 5,
        service_charge: 0,
        tax: 0,
        grand_total: 5,
        ...parsedOverrides,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
    }, []);
    return <ReviewScreen />;
  }
  return render(
    <BillProvider>
      <Harness />
    </BillProvider>
  );
}

test.afterEach(() => cleanup());

test('both present: merchant name renders as a heading, receipt date as a caption beneath it', () => {
  renderWith({ merchant_name: 'Restoran Uncle', receipt_date: '2026-09-28' });
  const heading = screen.getByRole('heading', { name: 'Restoran Uncle' });
  assert.equal(heading.tagName, 'H2');
  assert.ok(screen.getByText('2026-09-28'));
  // "Check the items" is still present, just no longer the top heading.
  assert.equal(screen.getByRole('heading', { name: 'Check the items' }).tagName, 'H3');
});

test('both null: neither line renders, no placeholder text, "Check the items" unaffected', () => {
  renderWith({ merchant_name: null, receipt_date: null });
  assert.equal(screen.queryByText(/Unknown merchant/i), null);
  assert.ok(screen.getByRole('heading', { name: 'Check the items' }));
  // No stray empty heading left behind by a falsy-but-rendered branch.
  assert.equal(screen.queryAllByRole('heading', { level: 2 }).length, 0);
});

test('merchant name present, date null: only the merchant heading renders', () => {
  renderWith({ merchant_name: 'Restoran Uncle', receipt_date: null });
  assert.ok(screen.getByRole('heading', { name: 'Restoran Uncle' }));
  assert.equal(screen.queryByText('2026-09-28'), null);
});

test('date present, merchant name null: only the caption renders, no empty heading', () => {
  renderWith({ merchant_name: null, receipt_date: '2026-09-28' });
  assert.ok(screen.getByText('2026-09-28'));
  assert.equal(screen.queryAllByRole('heading', { level: 2 }).length, 0);
});
