// src/screens/ReviewScreen.tick.test.jsx — the tick "This matches my paper
// receipt": when it shows, what it opens, when it clears, the Difference row,
// the reason lines and the refused-save message.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.tick.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions, useBillState } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';

const food = (name, line_total, discount = 0) => ({
  name,
  category: 'food',
  qty: 1,
  unit_price: line_total,
  line_total,
  discount,
});

// 100 + 9 + 5.94 = 114.94 before any difference.
function plainBill(grand_total = 114.94) {
  return {
    items: [food('Nasi A', 50), food('Mee B', 30), food('Teh C', 20)],
    subtotal: 100,
    service_charge: 9,
    tax: 5.94,
    discount: 0,
    rounding: 0,
    grand_total,
  };
}

let probe = null;
function renderWith(parsed, { people = [] } = {}) {
  function Harness() {
    const { setParsed, addPayer, setSaveError } = useBillActions();
    const state = useBillState();
    probe = { state, setSaveError };
    useEffect(() => {
      people.forEach((name) => addPayer(name));
      setParsed(parsed);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
    }, []);
    return (
      <>
        <span data-testid="current-screen">{state.screen}</span>
        <ReviewScreen />
      </>
    );
  }
  return render(
    <BillProvider>
      <Harness />
    </BillProvider>
  );
}

test.afterEach(() => cleanup());

const confirm = () => screen.getByRole('button', { name: 'Confirm and continue' });
const status = () => screen.getByTestId('reconcile-status');
const tick = () => screen.queryByRole('checkbox', { name: 'This matches my paper receipt' });
const diffRow = () => screen.queryByTestId('difference-row');
const reason = () => screen.queryByTestId('reconcile-block-reason');
const NEEDS_TICK = 'Tick that the screen matches your paper receipt, or fix the figure that is different';

async function setGrandTotal(user, value) {
  const input = screen.getByLabelText('Grand total');
  await user.clear(input);
  await user.type(input, String(value));
}

test('receipt that adds up: no tick, no Difference row, Confirm on, no reason line', () => {
  renderWith(plainBill());
  assert.equal(tick(), null);
  assert.equal(diffRow(), null);
  assert.equal(confirm().disabled, false);
  assert.equal(reason(), null);
  assert.equal(status().getAttribute('data-state'), 'ok');
});

test('gap, not ticked: tick shown unticked with the exact gap, Confirm off with the reason, no Difference row', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  assert.ok(tick());
  assert.equal(tick().checked, false);
  assert.match(screen.getByTestId('receipt-tick-block').textContent, /The receipt total is RM 0\.03 higher than its own lines add up to\./);
  assert.match(screen.getByTestId('receipt-tick-block').textContent, /Nothing on the receipt is changed\./);
  assert.equal(confirm().disabled, true);
  assert.equal(reason().textContent, NEEDS_TICK);
  assert.equal(diffRow(), null);
  assert.equal(status().getAttribute('data-state'), 'error');
  assert.match(status().textContent, /Does not add up: RM 0\.03 short/);
  assert.match(status().textContent, /tick the box above Confirm/);
  assert.equal(screen.queryByRole('button', { name: /rounding/i, description: /difference/i }), null);
});

test('ticking opens Confirm, turns the panel neutral, shows the Difference row, and changes no printed figure', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  assert.equal(tick().checked, true);
  assert.equal(confirm().disabled, false);
  assert.equal(reason(), null);
  assert.equal(status().getAttribute('data-state'), 'ticked');
  assert.match(status().textContent, /Matches your paper receipt/);
  assert.match(status().textContent, /Difference on receipt: adds RM 0\.03\. Everything else is as shown\./);
  assert.doesNotMatch(status().textContent, /Does not add up/);
  assert.match(diffRow().textContent, /Difference on receipt/);
  assert.match(diffRow().textContent, /Adds RM 0\.03/);
  // Nothing scanned moved: rounding stays empty, grand total stays as scanned.
  assert.equal(screen.getByLabelText('Grand total').value, '114.97');
  assert.equal(screen.queryByTestId('rounding-row'), null);
  assert.equal(screen.queryByTestId('bill-discount-row'), null);
  // The Difference row is read-only.
  assert.equal(diffRow().querySelector('input'), null);
  assert.equal(diffRow().querySelector('button'), null);
});

test('a gap the other way reads "takes off" in the tick, the panel and the row', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.91);
  assert.match(screen.getByTestId('receipt-tick-block').textContent, /RM 0\.03 lower than its own lines add up to/);
  await user.click(tick());
  assert.match(status().textContent, /takes off RM 0\.03/);
  assert.match(diffRow().textContent, /Takes off RM 0\.03/);
});

test('Confirm with the tick goes on to payment', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  await user.click(confirm());
  assert.equal(screen.getByTestId('current-screen').textContent, 'payment');
});

test('the tick can be taken back by hand', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  await user.click(tick());
  assert.equal(tick().checked, false);
  assert.equal(confirm().disabled, true);
  assert.equal(diffRow(), null);
  assert.equal(screen.queryByTestId('tick-cleared-note'), null);
});

test('any edit after ticking clears the tick with a note; fixing the figure so it adds up removes tick, row and note', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  await user.clear(screen.getByLabelText('Service charge'));
  await user.type(screen.getByLabelText('Service charge'), '9.05');
  assert.equal(tick().checked, false);
  assert.equal(confirm().disabled, true);
  assert.equal(diffRow(), null);
  assert.match(screen.getByTestId('tick-cleared-note').textContent, /Tick cleared because a figure changed/);
  assert.match(status().textContent, /Does not add up/);
  // Make it exact: 100 + 9.05 + 5.94 = 114.99.
  await setGrandTotal(user, 114.99);
  assert.equal(tick(), null);
  assert.equal(diffRow(), null);
  assert.equal(screen.queryByTestId('tick-cleared-note'), null);
  assert.equal(status().getAttribute('data-state'), 'ok');
  assert.equal(confirm().disabled, false);
});

test('editing a figure and putting it back does not bring the old tick back', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  await user.clear(screen.getByLabelText('Tax (SST)'));
  await user.type(screen.getByLabelText('Tax (SST)'), '6');
  await user.clear(screen.getByLabelText('Tax (SST)'));
  await user.type(screen.getByLabelText('Tax (SST)'), '5.94');
  assert.equal(tick().checked, false);
  assert.equal(confirm().disabled, true);
});

test('changing who ordered an item keeps the tick, the Difference row and Confirm', async () => {
  const user = userEvent.setup();
  renderWith(plainBill(), { people: ['Bea'] });
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  await user.click(screen.getByRole('button', { name: /Nasi A/ }));
  const bea = screen.getAllByRole('checkbox', { name: /Bea/ })[0];
  const before = bea.checked;
  await user.click(bea);
  assert.notEqual(bea.checked, before, 'the assignment really changed');
  assert.equal(tick().checked, true);
  assert.ok(diffRow());
  assert.equal(confirm().disabled, false);
  assert.equal(screen.queryByTestId('tick-cleared-note'), null);
});

test('an impossible figure: no tick is rendered, Confirm stays off with the hard-error reason', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(screen.getByRole('button', { name: '+ Add discount' }));
  await user.type(screen.getByLabelText('Discount (whole bill)'), '150');
  assert.match(status().textContent, /Discount is more than the items total/);
  assert.equal(tick(), null);
  assert.equal(screen.queryByTestId('receipt-tick-block'), null);
  assert.equal(confirm().disabled, true);
  assert.equal(reason().textContent, 'Confirm is off until the problem shown in Bill totals is fixed.');
});

test('ticking and then typing a discount above its item removes the tick (not greyed) and keeps Confirm off', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  await user.click(screen.getByRole('button', { name: /Nasi A/ }));
  await user.click(screen.getByRole('button', { name: '+ Add discount to this item' }));
  await user.type(screen.getByLabelText('Discount on Nasi A'), '99');
  assert.match(status().textContent, /Fix the discount on Nasi A first/);
  assert.equal(tick(), null);
  assert.equal(confirm().disabled, true);
});

test('a refused save: the message shows above the tick, the tick is cleared, and the next edit removes the message', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  await user.click(tick());
  fireEvent.click(confirm());
  probe.setSaveError('receipt_does_not_add_up');
  await screen.findByTestId('save-not-add-up');
  const box = screen.getByTestId('save-not-add-up');
  assert.equal(box.getAttribute('role'), 'alert');
  assert.match(box.textContent, /We could not save this because the figures do not add up\./);
  assert.equal(tick().checked, false);
  assert.equal(confirm().disabled, true);
  assert.equal(reason().textContent, NEEDS_TICK);
  // The figures the host typed are still there.
  assert.equal(screen.getByLabelText('Grand total').value, '114.97');
  await user.clear(screen.getByLabelText('Tax (SST)'));
  await user.type(screen.getByLabelText('Tax (SST)'), '5.95');
  assert.equal(screen.queryByTestId('save-not-add-up'), null);
});

test('the old "difference is RM 0.00" line is gone, and there is no use-as-rounding button anywhere', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  assert.doesNotMatch(document.body.textContent, /Confirm is off until the difference is RM 0\.00/);
  assert.equal(screen.queryByRole('button', { name: /use this difference/i }), null);
  await user.click(tick());
  assert.equal(screen.queryByRole('button', { name: /use this difference/i }), null);
});
