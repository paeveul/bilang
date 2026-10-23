// A scan whose lines do not add up to its printed total: the host ticks that
// the screen matches the paper, the split is created with the exact stated
// difference, and a refusal from the server brings the host back to Review
// with everything intact and the tick cleared.
//
// Network: fully stubbed (src/test/fetch-stub.mjs).
import { window as jsdomWindow } from './test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { installFetchStub, uninstallFetchStub, reply } from './test/fetch-stub.mjs';
import { pickAndConfirm } from './test/capture-helpers.mjs';

globalThis.FileReader = jsdomWindow.FileReader;

// 8 + 2.5 + 1.05 + 0.63 = 12.18; the paper prints 12.21, three sen more.
const PARSED_RECEIPT = {
  items: [
    { name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 8, line_total: 8, discount: 0 },
    { name: 'Teh Tarik', category: 'drink', qty: 1, unit_price: 2.5, line_total: 2.5, discount: 0 },
  ],
  subtotal: 10.5,
  service_charge: 1.05,
  tax: 0.63,
  discount: 0,
  rounding: 0,
  grand_total: 12.21,
};

function fakeReceiptFile() {
  return new jsdomWindow.File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'receipt.jpg', {
    type: 'image/jpeg',
  });
}

test.afterEach(() => {
  cleanup();
  uninstallFetchStub();
  window.history.pushState(null, '', '/');
});

async function reachReviewTicked(user) {
  await user.type(await screen.findByLabelText('Email address'), 'ali@example.com');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '424242');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.click(await screen.findByRole('button', { name: 'Start a new split' }));
  await pickAndConfirm(user, fakeReceiptFile());
  await screen.findByText('Check the items');
  const confirm = await screen.findByRole('button', { name: 'Confirm and continue' });
  assert.equal(confirm.disabled, true, 'a receipt that does not add up needs the tick');
  await user.click(screen.getByRole('checkbox', { name: 'This matches my paper receipt' }));
  await waitFor(() => assert.equal(confirm.disabled, false));
  await user.click(confirm);
  await screen.findByText('How should people pay you?');
  await user.type(screen.getByPlaceholderText(/DuitNow/), 'DuitNow: 012-3456789 (Test Owner)');
}

function stub(onSplit) {
  return installFetchStub((call) => {
    if (call.url === '/api/v1/auth/session') return reply(200, { signedIn: false });
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') return reply(200, { accountId: 'acct-gap' });
    if (call.url === '/api/v1/parse') return reply(200, PARSED_RECEIPT);
    if (call.url === '/api/v1/split' && call.method === 'POST') return onSplit(call);
    return undefined;
  });
}

test('ticked difference: the saved split states the exact difference, shares add to the printed total, printed figures untouched', async () => {
  const calls = stub(() => reply(200, { id: 'gap123', url: '/s/gap123' }));
  const user = userEvent.setup();
  render(<App />);
  await reachReviewTicked(user);
  await user.click(screen.getByRole('button', { name: 'Create the split' }));
  await screen.findByText('Your split is ready 🎉');

  const submitted = calls.find((c) => c.url === '/api/v1/split' && c.method === 'POST').body;
  assert.equal(submitted.totals.receipt_gap_cents, 3);
  assert.equal(submitted.totals.receipt_gap_acknowledged, true);
  assert.equal(submitted.totals.grand_total, 12.21);
  assert.equal(submitted.totals.rounding, 0);
  assert.equal(submitted.totals.discount, 0);
  assert.equal(submitted.totals.service_charge, 1.05);
  assert.equal(submitted.totals.tax, 0.63);
  const paid = Object.values(submitted.totals.per_person).reduce((s, v) => s + Math.round(v * 100), 0);
  assert.equal(paid, 1221);
  submitted.items.forEach((item, i) => {
    assert.equal(item.line_total, PARSED_RECEIPT.items[i].line_total);
    assert.equal(item.unit_price, PARSED_RECEIPT.items[i].unit_price);
  });
});

test('the server refuses the figures: back on Review with the message, the tick cleared and nothing the host typed lost', async () => {
  stub(() => reply(400, { error: 'The amounts do not add up to the receipt total.', code: 'receipt_does_not_add_up' }));
  const user = userEvent.setup();
  render(<App />);
  await reachReviewTicked(user);
  await user.click(screen.getByRole('button', { name: 'Create the split' }));

  const box = await screen.findByTestId('save-not-add-up');
  assert.match(box.textContent, /We could not save this because the figures do not add up\./);
  assert.equal(screen.getByRole('checkbox', { name: 'This matches my paper receipt' }).checked, false);
  assert.equal(screen.getByRole('button', { name: 'Confirm and continue' }).disabled, true);
  assert.equal(screen.getByLabelText('Grand total').value, '12.21');
  assert.equal(screen.queryByText('Something went wrong'), null);
});
