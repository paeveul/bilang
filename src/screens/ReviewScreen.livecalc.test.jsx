// src/screens/ReviewScreen.livecalc.test.jsx — editing an item's quantity or
// price on the Review screen: the line price follows, the cue says how it got
// there, the subtotal moves with it, and nothing else on the bill moves.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.livecalc.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';

const food = (name, qty, unit_price, line_total) => ({
  name,
  category: 'food',
  qty,
  unit_price,
  line_total,
  discount: 0,
});

function plainBill() {
  return {
    items: [food('Nasi A', 2, 6.5, 13), food('Mee B', 1, 4, 4)],
    subtotal: 17,
    service_charge: 1.7,
    tax: 1.02,
    discount: 0,
    rounding: 0,
    grand_total: 19.72,
  };
}

function renderReview(parsed) {
  function Harness() {
    const { setParsed } = useBillActions();
    useEffect(() => {
      setParsed(parsed);
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

const lineTotal = () => screen.getByLabelText('Line total');
const cue = () => screen.queryByTestId('line-price-cue');
const change = (el, value) => fireEvent.change(el, { target: { value: String(value) } });

async function openFirstItem() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Nasi A/ }));
  return user;
}

test('an untouched scan shows no cue and the plain subtotal note', () => {
  renderReview(plainBill());
  assert.equal(cue(), null);
  assert.ok(screen.getByText('For your reference'));
  assert.equal(screen.getByLabelText('Subtotal').value, '17');
});

test('qty edit: the line price follows with the calculated cue; the subtotal moves; the grand total, service and tax stay', async () => {
  renderReview(plainBill());
  await openFirstItem();
  change(screen.getByLabelText('Qty'), 3);
  assert.equal(lineTotal().value, '19.5');
  assert.equal(cue().textContent, 'Calculated from qty x price');
  assert.equal(screen.getByLabelText('Subtotal').value, '23.5');
  assert.ok(screen.getByText('Moved with your item edit. For your reference.'));
  assert.equal(screen.queryByText('For your reference'), null);
  assert.equal(screen.getByLabelText('Grand total').value, '19.72');
  assert.equal(screen.getByLabelText('Service charge').value, '1.7');
  assert.equal(screen.getByLabelText('Tax (SST)').value, '1.02');
  assert.equal(screen.getByLabelText('Qty').value, '3');
  assert.equal(screen.getByLabelText('Unit price').value, '6.5');
});

test('qty accepts a decimal such as 0.333 and a typed "0." followed by "3" is kept', async () => {
  renderReview(plainBill());
  await openFirstItem();
  const qty = screen.getByLabelText('Qty');
  assert.equal(qty.getAttribute('step'), 'any');
  assert.equal(qty.getAttribute('inputmode'), 'decimal');
  change(qty, '0.');
  change(screen.getByLabelText('Qty'), '0.3');
  change(screen.getByLabelText('Qty'), '0.333');
  assert.equal(screen.getByLabelText('Qty').value, '0.333');
  assert.equal(lineTotal().value, '2.16');
});

test('a sub-sen product shows the rounded cue; a whole-sen product goes back to the calculated cue', async () => {
  renderReview(plainBill());
  await openFirstItem();
  change(screen.getByLabelText('Unit price'), 10.1);
  change(screen.getByLabelText('Qty'), 0.25);
  assert.equal(lineTotal().value, '2.53');
  assert.equal(cue().textContent, 'Rounded to the nearest sen');
  assert.equal(screen.getByLabelText('Qty').value, '0.25');
  assert.equal(screen.getByLabelText('Unit price').value, '10.1');
  change(screen.getByLabelText('Qty'), 2);
  assert.equal(lineTotal().value, '20.2');
  assert.equal(cue().textContent, 'Calculated from qty x price');
});

test('overwriting the line price keeps the typed value and shows the kept cue; qty and unit price stay', async () => {
  renderReview(plainBill());
  await openFirstItem();
  change(screen.getByLabelText('Unit price'), 10.1);
  change(screen.getByLabelText('Qty'), 0.25);
  change(lineTotal(), 2.52);
  assert.equal(lineTotal().value, '2.52');
  assert.equal(cue().textContent, 'Price as you entered it');
  assert.equal(screen.getByLabelText('Qty').value, '0.25');
  assert.equal(screen.getByLabelText('Unit price').value, '10.1');
});

test('the cue is tied to the line price field for screen readers', async () => {
  renderReview(plainBill());
  await openFirstItem();
  change(screen.getByLabelText('Qty'), 3);
  assert.equal(lineTotal().getAttribute('aria-describedby'), cue().id);
});

test('the changed line price and the subtotal carry a soft highlight that is gone after 600 ms', async () => {
  renderReview(plainBill());
  await openFirstItem();
  change(screen.getByLabelText('Qty'), 3);
  assert.ok(lineTotal().className.includes('bg-slate-100'));
  assert.ok(screen.getByLabelText('Subtotal').className.includes('bg-slate-100'));
  // Printed fields are never highlighted.
  assert.equal(screen.getByLabelText('Grand total').className.includes('bg-slate-100'), false);
  assert.equal(screen.getByLabelText('Qty').className.includes('bg-slate-100'), false);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(lineTotal().className.includes('bg-slate-100'), false);
  assert.equal(screen.getByLabelText('Subtotal').className.includes('bg-slate-100'), false);
});
