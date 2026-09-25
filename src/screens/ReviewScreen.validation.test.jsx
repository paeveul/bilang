// src/screens/ReviewScreen.validation.test.jsx — client-side item checks on
// the Review screen (mirror of api/_lib/validate.js's item rules). Proves:
// qty 0 blocked, blank name blocked, valid data proceeds, message names the
// item, focus/aria are set, messages clear when fixed, and "Set amounts"
// mode still works. Plus unit checks of the pure rules in review-validation.js.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.validation.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions, useBillState } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';
import { validateItems } from './review-validation.js';

function makeHarness(items) {
  return function Harness() {
    const { setParsed } = useBillActions();
    const { screen: current } = useBillState();
    useEffect(() => {
      setParsed({ items, subtotal: 10, service_charge: 0, tax: 0, grand_total: 10 });
      // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
    }, []);
    return (
      <>
        <span data-testid="current-screen">{current}</span>
        <ReviewScreen />
      </>
    );
  };
}

function renderWith(items) {
  const Harness = makeHarness(items);
  return render(
    <BillProvider>
      <Harness />
    </BillProvider>
  );
}

const good = { name: 'Chicken Rice', category: 'food', qty: 1, unit_price: 10, line_total: 10 };
const confirm = () => screen.getByRole('button', { name: 'Confirm and continue' });
const currentScreen = () => screen.getByTestId('current-screen').textContent;

test.afterEach(() => cleanup());

test('valid items: Confirm proceeds to payment, no error shown', async () => {
  const user = userEvent.setup();
  renderWith([good]);
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
  assert.equal(screen.queryByRole('alert'), null);
});

test('qty 0: blocked, message names the item, field is aria-invalid + described, focus lands on it', async () => {
  const user = userEvent.setup();
  renderWith([{ ...good, qty: 0 }]);
  await user.click(confirm());

  assert.notEqual(currentScreen(), 'payment', 'must not proceed');
  const alert = screen.getByRole('alert');
  assert.match(alert.textContent, /"Chicken Rice": quantity must be more than 0\./);

  const qty = screen.getByLabelText('Qty');
  assert.equal(qty.getAttribute('aria-invalid'), 'true');
  const described = document.getElementById(qty.getAttribute('aria-describedby'));
  assert.match(described.textContent, /quantity must be more than 0/);
  assert.equal(document.activeElement, qty, 'focus goes to the first problem field');
});

test('blank name: blocked, message says which item (by position), focus on name field', async () => {
  const user = userEvent.setup();
  renderWith([good, { ...good, name: '   ' }]);
  await user.click(confirm());

  assert.notEqual(currentScreen(), 'payment');
  assert.match(screen.getByRole('alert').textContent, /Item 2 has no name\. Type what it is\./);
  const nameInput = screen.getByLabelText('Item name');
  assert.equal(nameInput.getAttribute('aria-invalid'), 'true');
  assert.equal(document.activeElement, nameInput);
});

test('fixing the field clears the message and Confirm then proceeds', async () => {
  const user = userEvent.setup();
  renderWith([{ ...good, qty: 0 }]);
  await user.click(confirm());
  assert.ok(screen.getByRole('alert'));

  const qty = screen.getByLabelText('Qty');
  await user.clear(qty);
  await user.type(qty, '2');
  assert.equal(screen.queryByRole('alert'), null);
  assert.equal(qty.getAttribute('aria-invalid'), null);

  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
});

test('several bad items: summary counts them, offending rows opened', async () => {
  const user = userEvent.setup();
  renderWith([{ ...good, qty: 0 }, { ...good, name: 'Teh', unit_price: -1 }]);
  await user.click(confirm());
  assert.match(screen.getByRole('alert').textContent, /2 items need fixing/);
  assert.equal(screen.getAllByLabelText('Qty').length, 2, 'both rows expanded');
});

test('no regression: "Set amounts" mode still blocks an unallocated item and Confirm stays disabled', async () => {
  const user = userEvent.setup();
  renderWith([good]);
  await user.click(screen.getByRole('button', { name: /Chicken Rice/ }));
  await user.click(screen.getByRole('radio', { name: 'Set amounts' }));
  assert.equal(confirm().disabled, true, 'unresolved manual item still disables Confirm');
  const amount = screen.getByLabelText("Me's amount for Chicken Rice");
  await user.clear(amount);
  await user.type(amount, '10.00');
  assert.equal(confirm().disabled, false);
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
});

test('pure rules: mirrors the server (qty, name, price, total finite, category, name length)', () => {
  const bad = (over) => validateItems([{ id: 'x', ...good, ...over }])[0]?.problems.map((p) => p.field) ?? [];
  assert.deepEqual(bad({}), []);
  assert.deepEqual(bad({ qty: 0 }), ['qty']);
  assert.deepEqual(bad({ qty: -1 }), ['qty']);
  assert.deepEqual(bad({ qty: NaN }), ['qty']);
  assert.deepEqual(bad({ qty: 0.5 }), [], 'server allows fractional qty > 0');
  assert.deepEqual(bad({ name: '' }), ['name']);
  assert.deepEqual(bad({ name: 'a'.repeat(201) }), ['name']);
  assert.deepEqual(bad({ unit_price: -0.01 }), ['unit_price']);
  assert.deepEqual(bad({ unit_price: 0 }), []);
  assert.deepEqual(bad({ unit_price: Infinity }), ['unit_price']);
  assert.deepEqual(bad({ line_total: NaN }), ['line_total']);
  assert.deepEqual(bad({ category: 'dessert' }), ['category']);
});
