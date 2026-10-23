// src/screens/ReviewScreen.discount.test.jsx — discount and rounding on the
// Review screen: item rows, the Discount and Rounding rows, the status panel,
// the Confirm block and its reason, the hint, and "use this difference as
// rounding".
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.discount.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions, useBillState } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';

const food = (name, line_total, discount) => ({
  name,
  category: 'food',
  qty: 1,
  unit_price: line_total,
  line_total,
  ...(discount === undefined ? {} : { discount }),
});

// Three items, no discount, no rounding: 100 + 9 + 5.94 = 114.94.
function plainBill(overrides = {}) {
  return {
    items: [food('Nasi A', 50, 0), food('Mee B', 30, 0), food('Teh C', 20, 0)],
    subtotal: 100,
    service_charge: 9,
    tax: 5.94,
    discount: 0,
    rounding: 0,
    grand_total: 114.94,
    ...overrides,
  };
}

// Bill discount 10 and rounding +0.01: 100 - 10 + 9 + 5.94 + 0.01 = 104.95.
const billWithDiscountAndRounding = () => plainBill({ discount: 10, rounding: 0.01, grand_total: 104.95 });

// Item X 40 with its own 8.00 discount, item Y 60: 32 + 60 + 9.2 = 101.20.
const billWithItemDiscount = () => ({
  items: [food('Satay X', 40, 8), food('Rice Y', 60, 0)],
  subtotal: 100,
  service_charge: 9.2,
  tax: 0,
  discount: 0,
  rounding: 0,
  grand_total: 101.2,
});

function renderWith(parsed, { people = [] } = {}) {
  function Harness() {
    const { setParsed, addPayer } = useBillActions();
    const { screen: current } = useBillState();
    useEffect(() => {
      people.forEach((name) => addPayer(name));
      setParsed(parsed);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
    }, []);
    return (
      <>
        <span data-testid="current-screen">{current}</span>
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

const confirm = () => screen.getByRole('button', { name: 'Confirm and continue' });
const status = () => screen.getByTestId('reconcile-status');
const grandTotal = () => screen.getByLabelText('Grand total');
const currentScreen = () => screen.getByTestId('current-screen').textContent;

async function setGrandTotal(user, value) {
  const input = grandTotal();
  await user.clear(input);
  await user.type(input, String(value));
}

test.afterEach(() => cleanup());

test('a receipt with no discount and no rounding shows no discount or rounding row, line or value', () => {
  renderWith(plainBill());
  assert.equal(screen.queryByTestId('bill-discount-row'), null);
  assert.equal(screen.queryByTestId('rounding-row'), null);
  assert.equal(screen.queryByTestId('item-discount-line'), null);
  assert.equal(screen.queryByText(/Discount −/), null);
  assert.equal(screen.queryByText(/No rounding/), null);
  // The two host-only add buttons, the green status and the reference label are allowed.
  assert.ok(screen.getByRole('button', { name: '+ Add discount' }));
  assert.ok(screen.getByRole('button', { name: '+ Add rounding' }));
  assert.ok(screen.getByText('For your reference'));
  assert.equal(status().getAttribute('data-state'), 'ok');
  assert.equal(confirm().disabled, false);
});

test('a bill that adds up exactly shows the green status, no error banner, and Confirm is on', () => {
  renderWith(billWithDiscountAndRounding());
  assert.match(status().textContent, /Adds up to the receipt/);
  assert.match(status().textContent, /RM 104\.95/);
  assert.equal(screen.queryByRole('alert'), null);
  assert.equal(confirm().disabled, false);
  assert.equal(screen.queryByTestId('reconcile-block-reason'), null);
});

test('the Discount (whole bill) row and a signed Rounding row show with the scanned values', () => {
  renderWith(billWithDiscountAndRounding());
  const discountRow = screen.getByTestId('bill-discount-row');
  assert.equal(within(discountRow).getByLabelText('Discount (whole bill)').value, '10');
  const roundingRow = screen.getByTestId('rounding-row');
  assert.equal(within(roundingRow).getByLabelText('Rounding amount').value, '0.01');
  assert.match(screen.getByTestId('rounding-summary').textContent, /Adds RM 0\.01 to the bill/);
  assert.equal(within(roundingRow).getByRole('radio', { name: 'Adds' }).getAttribute('aria-checked'), 'true');
  assert.equal(screen.queryByTestId('rounding-edited-tag'), null);
});

test('a negative scanned rounding shows Takes off and a positive amount', () => {
  renderWith(plainBill({ rounding: -0.02, grand_total: 114.92 }));
  const roundingRow = screen.getByTestId('rounding-row');
  assert.equal(within(roundingRow).getByLabelText('Rounding amount').value, '0.02');
  assert.equal(within(roundingRow).getByRole('radio', { name: 'Takes off' }).getAttribute('aria-checked'), 'true');
  assert.match(screen.getByTestId('rounding-summary').textContent, /Takes RM 0\.02 off the bill/);
  assert.equal(status().getAttribute('data-state'), 'ok');
});

test('an item with a discount shows the price and discount line, and the net amount on the right', () => {
  renderWith(billWithItemDiscount());
  const line = screen.getByTestId('item-discount-line');
  assert.match(line.textContent, /Price RM 40\.00 · Discount −RM 8\.00/);
  assert.match(line.textContent, /Price RM 40\.00, discount minus RM 8\.00/);
  const row = screen.getByRole('button', { name: /Satay X/ });
  assert.match(row.textContent, /RM32\.00/);
  assert.equal(status().getAttribute('data-state'), 'ok');
});

test('the item discount can be added, edited and removed, and the status follows', async () => {
  const user = userEvent.setup();
  renderWith(plainBill({ items: [food('Nasi A', 50), food('Mee B', 50)], subtotal: 100, service_charge: 0, tax: 0, grand_total: 100 }));
  await user.click(screen.getByRole('button', { name: /Nasi A/ }));
  await user.click(screen.getByRole('button', { name: '+ Add discount to this item' }));
  const field = screen.getByLabelText('Discount on Nasi A');
  assert.equal(document.activeElement, field);
  await user.type(field, '8');
  assert.match(screen.getByText(/You pay RM 42\.00 for this item\./).textContent, /42\.00/);
  assert.match(status().textContent, /Does not add up: RM 8\.00 short/);
  await setGrandTotal(user, 92);
  assert.equal(status().getAttribute('data-state'), 'ok');
  await user.click(screen.getByRole('button', { name: 'Remove discount' }));
  assert.equal(screen.queryByLabelText('Discount on Nasi A'), null);
  assert.equal(screen.queryByTestId('item-discount-line'), null);
  assert.ok(screen.getByRole('button', { name: '+ Add discount to this item' }));
});

test('a minus typed into a discount box is dropped and the discount stays positive', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await user.click(screen.getByRole('button', { name: '+ Add discount' }));
  const field = screen.getByLabelText('Discount (whole bill)');
  assert.equal(document.activeElement, field);
  await user.type(field, '-10');
  assert.equal(field.value, '10');
  await setGrandTotal(user, 104.94);
  assert.equal(status().getAttribute('data-state'), 'ok');
});

test('one sen off: red status with the exact signed difference, Confirm off with a visible reason', async () => {
  const user = userEvent.setup();
  renderWith(billWithDiscountAndRounding());
  await setGrandTotal(user, 104.96);
  assert.equal(status().getAttribute('data-state'), 'error');
  assert.match(status().textContent, /Does not add up: RM 0\.01 short/);
  assert.match(status().textContent, /Your numbers come to RM 104\.95\. The receipt total is RM 104\.96\./);
  assert.equal(confirm().disabled, true);
  assert.match(screen.getByTestId('reconcile-block-reason').textContent, /Tick that the screen matches your paper receipt, or fix the figure that is different/);
  await setGrandTotal(user, 104.94);
  assert.match(status().textContent, /Does not add up: RM 0\.01 over/);
  await setGrandTotal(user, 104.95);
  assert.equal(status().getAttribute('data-state'), 'ok');
  assert.equal(confirm().disabled, false);
  assert.equal(screen.queryByTestId('reconcile-block-reason'), null);
});

test('Confirm does nothing while the receipt does not add up', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 115);
  await user.click(confirm());
  assert.notEqual(currentScreen(), 'payment');
});

const roundingButton = () => screen.queryByRole('button', { name: 'Use this difference as rounding' });

test('a small gap is never booked as rounding by the app: no button, status stays red, Confirm off', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await setGrandTotal(user, 114.97);
  assert.match(status().textContent, /RM 0\.03 short/);
  assert.equal(roundingButton(), null);
  assert.equal(screen.queryByTestId('rounding-too-big'), null);
  assert.equal(status().getAttribute('data-state'), 'error');
  assert.equal(confirm().disabled, true);
  assert.equal(screen.queryByTestId('rounding-row'), null);
});

test('the host can still hand-correct the rounding to match the paper receipt; Undo puts it back', async () => {
  const user = userEvent.setup();
  renderWith(plainBill({ rounding: 0.01, grand_total: 114.95 }));
  assert.equal(status().getAttribute('data-state'), 'ok');
  const roundingRow = screen.getByTestId('rounding-row');
  const field = within(roundingRow).getByLabelText('Rounding amount');
  await setGrandTotal(user, 114.97);
  assert.match(status().textContent, /RM 0\.02 short/);
  assert.equal(roundingButton(), null);
  await user.clear(field);
  await user.type(field, '0.03');
  assert.equal(status().getAttribute('data-state'), 'ok');
  assert.ok(screen.getByTestId('rounding-edited-tag'));
  assert.equal(confirm().disabled, false);
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  assert.equal(screen.queryByTestId('rounding-edited-tag'), null);
  assert.match(status().textContent, /RM 0\.02 short/);
});

test('over by a few sen with a rounding already there: no button is offered', async () => {
  const user = userEvent.setup();
  renderWith(billWithDiscountAndRounding());
  await setGrandTotal(user, 104.93);
  assert.match(status().textContent, /RM 0\.02 over/);
  assert.equal(roundingButton(), null);
  assert.equal(screen.queryByTestId('rounding-too-big'), null);
  assert.equal(within(screen.getByTestId('rounding-row')).getByLabelText('Rounding amount').value, '0.01');
});

test('whatever the size of the gap, neither the rounding button nor the too-big line is shown', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  for (const total of [114.99, 115, 115.94]) {
    await setGrandTotal(user, total);
    assert.equal(roundingButton(), null);
    assert.equal(screen.queryByTestId('rounding-too-big'), null);
    assert.equal(status().getAttribute('data-state'), 'error');
    assert.equal(confirm().disabled, true);
  }
});

test('a difference equal to a discount shows the hint in addition to the exact difference', async () => {
  const user = userEvent.setup();
  renderWith(billWithItemDiscount());
  // Net typed as the price: the line already showed 32.00 and 8.00 is taken off again.
  await setGrandTotal(user, 109.2);
  assert.match(status().textContent, /Does not add up: RM 8\.00 short/);
  const hint = screen.getByTestId('reconcile-hint').textContent;
  assert.match(hint, /A RM 8\.00 discount may be counted twice \(or missed\)\./);
  assert.match(hint, /Check the price and discount on that item\./);
  assert.match(hint, /It may have been taken off twice\./);
  await setGrandTotal(user, 93.2);
  assert.match(screen.getByTestId('reconcile-hint').textContent, /It may have been left out\./);
});

test('the hint names the whole-bill discount when that is what matches', async () => {
  const user = userEvent.setup();
  renderWith(billWithDiscountAndRounding());
  await setGrandTotal(user, 114.95);
  assert.match(screen.getByTestId('reconcile-hint').textContent, /Check Discount \(whole bill\)\./);
});

test('a discount bigger than its item: inline error, red status naming the item, Confirm off, no rounding button', async () => {
  const user = userEvent.setup();
  renderWith(billWithItemDiscount());
  await user.click(screen.getByRole('button', { name: /Satay X/ }));
  const field = screen.getByLabelText('Discount on Satay X');
  await user.clear(field);
  await user.type(field, '41');
  assert.equal(field.getAttribute('aria-invalid'), 'true');
  const described = document.getElementById(field.getAttribute('aria-describedby'));
  assert.match(described.textContent, /Discount is more than the item price\./);
  assert.match(described.textContent, /Lower it, or put the extra under Discount for the whole bill\./);
  assert.match(status().textContent, /Fix the discount on Satay X first\./);
  assert.equal(confirm().disabled, true);
  assert.equal(screen.queryByRole('button', { name: 'Use this difference as rounding' }), null);
  // Equal to the price is allowed (a free item).
  await user.clear(field);
  await user.type(field, '40');
  assert.equal(screen.queryByTestId('item-discount-error'), null);
  assert.doesNotMatch(status().textContent, /Fix the discount/);
});

test('a whole-bill discount bigger than the items total: its own red message, Confirm off, no rounding button', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await user.click(screen.getByRole('button', { name: '+ Add discount' }));
  await user.type(screen.getByLabelText('Discount (whole bill)'), '150');
  assert.match(status().textContent, /Discount is more than the items total/);
  assert.doesNotMatch(status().textContent, /Does not add up/);
  assert.equal(confirm().disabled, true);
  assert.equal(screen.queryByRole('button', { name: 'Use this difference as rounding' }), null);
  assert.equal(screen.queryByTestId('rounding-too-big'), null);
});

test('a whole-bill discount equal to the items total is allowed', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await user.click(screen.getByRole('button', { name: '+ Add discount' }));
  await user.type(screen.getByLabelText('Discount (whole bill)'), '100');
  assert.doesNotMatch(status().textContent, /Discount is more than the items total/);
  await setGrandTotal(user, 14.94);
  assert.equal(status().getAttribute('data-state'), 'ok');
});

test('Adds and Takes off give a signed rounding; the summary and status follow', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await user.click(screen.getByRole('button', { name: '+ Add rounding' }));
  const roundingRow = screen.getByTestId('rounding-row');
  const amount = within(roundingRow).getByLabelText('Rounding amount');
  assert.equal(document.activeElement, amount);
  assert.match(screen.getByTestId('rounding-summary').textContent, /No rounding/);
  await user.click(within(roundingRow).getByRole('radio', { name: 'Takes off' }));
  await user.type(amount, '0.02');
  assert.match(screen.getByTestId('rounding-summary').textContent, /Takes RM 0\.02 off the bill/);
  assert.match(status().textContent, /RM 0\.02 short/);
  await setGrandTotal(user, 114.92);
  assert.equal(status().getAttribute('data-state'), 'ok');
  await user.click(within(roundingRow).getByRole('radio', { name: 'Adds' }));
  assert.match(screen.getByTestId('rounding-summary').textContent, /Adds RM 0\.02 to the bill/);
  assert.match(status().textContent, /RM 0\.04 over/);
});

test('a row the host added stays at 0.00 until Remove, and Remove puts focus on the add button', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await user.click(screen.getByRole('button', { name: '+ Add rounding' }));
  assert.ok(screen.getByTestId('rounding-row'));
  assert.equal(screen.queryByRole('button', { name: '+ Add rounding' }), null);
  await user.click(screen.getByRole('button', { name: 'Remove rounding' }));
  assert.equal(screen.queryByTestId('rounding-row'), null);
  assert.equal(document.activeElement, screen.getByRole('button', { name: '+ Add rounding' }));
});

test('rounding changed from the scanned value is tagged; manual-entry rounding is not', async () => {
  const user = userEvent.setup();
  // Scanned: the rounding value was read, so a change is an edit.
  renderWith(billWithDiscountAndRounding());
  const amount = within(screen.getByTestId('rounding-row')).getByLabelText('Rounding amount');
  await user.clear(amount);
  await user.type(amount, '0.02');
  assert.ok(screen.getByTestId('rounding-edited-tag'));
  cleanup();

  // No scanned rounding value (nothing was read): never tagged.
  const bare = plainBill();
  delete bare.rounding;
  delete bare.discount;
  renderWith({ ...bare, items: bare.items.map(({ discount, ...rest }) => rest) });
  assert.equal(screen.queryByTestId('reconcile-status'), null);
  await user.click(screen.getByRole('button', { name: '+ Add rounding' }));
  await user.type(screen.getByLabelText('Rounding amount'), '0.02');
  assert.equal(screen.queryByTestId('rounding-edited-tag'), null);
});

test('a percentage is worked out on the price after the item discount', async () => {
  const user = userEvent.setup();
  renderWith(billWithItemDiscount(), { people: ['Bea'] });
  await user.click(screen.getByRole('button', { name: /Satay X/ }));
  await user.click(screen.getByRole('radio', { name: 'Set amounts' }));
  await user.click(screen.getByRole('radio', { name: '%' }));
  const boxes = screen.getAllByRole('textbox', { name: /percentage for Satay X/ });
  await user.type(boxes[0], '50');
  // 50% of 32.00 (not of 40.00): 16.00 given out, 16.00 left to allocate.
  assert.ok(screen.getAllByText(/left to allocate/).some((el) => /RM 16\.00/.test(el.textContent)));
});

test('an older shape without the new fields shows no status panel and does not block Confirm', async () => {
  const user = userEvent.setup();
  renderWith({
    items: [{ name: 'Teh', category: 'drink', qty: 1, unit_price: 5, line_total: 5 }],
    subtotal: 5,
    service_charge: 0,
    tax: 0,
    grand_total: 99,
  });
  assert.equal(screen.queryByTestId('reconcile-status'), null);
  assert.equal(screen.queryByTestId('reconcile-live'), null);
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
});

test('the status is announced through one polite live region, after typing pauses', async () => {
  const user = userEvent.setup();
  renderWith(billWithDiscountAndRounding());
  const live = screen.getByTestId('reconcile-live');
  assert.equal(live.getAttribute('role'), 'status');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  await waitFor(() => assert.match(live.textContent, /Adds up to the receipt/));
  // Typing changes the visible panel at once, but the spoken text waits.
  await setGrandTotal(user, 104.96);
  assert.match(status().textContent, /RM 0\.01 short/);
  assert.match(live.textContent, /Adds up to the receipt/);
  await waitFor(() => assert.match(live.textContent, /Does not add up: RM 0\.01 short/), { timeout: 3000 });
});

const POINTER =
  'Check each amount against your paper receipt and fix the one that is different. If the screen already matches the paper, tick the box above Confirm.';

test('a difference of any size shows the pointer to the paper receipt; it goes away once the receipt adds up', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  for (const total of [114.97, 115, 120]) {
    await setGrandTotal(user, total);
    assert.equal(screen.getByTestId('reconcile-pointer').textContent, POINTER);
  }
  await setGrandTotal(user, 114.94);
  assert.equal(status().getAttribute('data-state'), 'ok');
  assert.equal(screen.queryByTestId('reconcile-pointer'), null);
  assert.doesNotMatch(status().textContent, /paper receipt/);
});

test('the pointer is not shown for the other red states', async () => {
  const user = userEvent.setup();
  renderWith(plainBill());
  await user.click(screen.getByRole('button', { name: '+ Add discount' }));
  await user.type(screen.getByLabelText('Discount (whole bill)'), '150');
  assert.match(status().textContent, /Discount is more than the items total/);
  assert.equal(screen.queryByTestId('reconcile-pointer'), null);
});

test('a difference leaves every scanned figure on screen exactly as scanned', async () => {
  const user = userEvent.setup();
  renderWith(billWithDiscountAndRounding());
  const rounding = () => within(screen.getByTestId('rounding-row')).getByLabelText('Rounding amount').value;
  const before = rounding();
  await setGrandTotal(user, 114.99);
  assert.equal(rounding(), before);
  assert.equal(screen.queryByTestId('rounding-edited-tag'), null);
});
