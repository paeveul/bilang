// src/App.item10.expiry.test.jsx — Item 10 Checkpoint 4, Step 11: mid-flow
// session expiry (plans §10.3 "Mid-flow expiry", §10.6 scenario 9).
//
// Rule under test: a session_expired reply during scanning or splitting opens
// the sign-in form above the current screen, never shows the error screen,
// never resets state, and retries the exact same request after sign-in.
//
// Network: fully stubbed (src/test/fetch-stub.mjs). No Supabase, Anthropic
// or email call can happen from this file.
import { window as jsdomWindow } from './test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { installFetchStub, uninstallFetchStub, reply } from './test/fetch-stub.mjs';

globalThis.FileReader = jsdomWindow.FileReader;

const EXPIRED_PARSE = 'Please sign in to scan a receipt.';
const EXPIRED_SPLIT = 'Please sign in to save this split.';

const PARSED_RECEIPT = {
  items: [
    { name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 8, line_total: 8 },
    { name: 'Teh Tarik', category: 'drink', qty: 1, unit_price: 2.5, line_total: 2.5 },
  ],
  subtotal: 10.5,
  service_charge: 1.05,
  tax: 0.63,
  grand_total: 12.18,
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

// Signs in through the overlay that opened above the current screen.
async function signInThroughOverlay(user) {
  await screen.findByRole('heading', { name: 'Sign in to keep going' });
  await user.type(screen.getByLabelText('Email address'), 'ali@example.com');
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '654321');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

test('scan expiry: the sign-in overlay opens, no error screen, and the same parse is retried with the same receipt', async () => {
  let parseCount = 0;
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/session') return reply(200, { signedIn: true, accountId: 'acct-1' });
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') return reply(200, { accountId: 'acct-1' });
    if (call.url === '/api/v1/parse') {
      parseCount += 1;
      if (parseCount === 1) return reply(401, { error: EXPIRED_PARSE, code: 'session_expired' });
      return reply(200, PARSED_RECEIPT);
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<App />);

  await user.click(await screen.findByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Start a new split' }));
  await user.upload(screen.getByLabelText('Upload receipt photo', { selector: 'input' }), fakeReceiptFile());

  await signInThroughOverlay(user);

  await screen.findByText('Check the items');
  assert.ok(screen.getByText('Nasi Lemak'), 'the retried scan must render its items');
  assert.equal(screen.queryByText('Start over'), null, 'the error screen must never appear');

  const parses = calls.filter((c) => c.url === '/api/v1/parse');
  assert.equal(parses.length, 2, 'the scan is retried exactly once after sign-in');
  assert.equal(parses[1].body.image, parses[0].body.image, 'the retry sends the same receipt image');
});

test('split expiry: corrections and payment details survive the sign-in, and the same corrected bill is created', async () => {
  let createCount = 0;
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/session') return reply(200, { signedIn: true, accountId: 'acct-1' });
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') return reply(200, { accountId: 'acct-1' });
    if (call.url === '/api/v1/parse') return reply(200, PARSED_RECEIPT);
    if (call.url === '/api/v1/split' && call.method === 'POST') {
      createCount += 1;
      if (createCount === 1) return reply(401, { error: EXPIRED_SPLIT, code: 'session_expired' });
      return reply(200, { id: 'expiry123', url: '/s/expiry123' });
    }
    return undefined;
  });
  const user = userEvent.setup();
  render(<App />);

  // Scan, then correct the first item's name on the review screen.
  await user.click(await screen.findByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Start a new split' }));
  await user.upload(screen.getByLabelText('Upload receipt photo', { selector: 'input' }), fakeReceiptFile());
  await screen.findByText('Check the items');
  // Item rows start collapsed; open the first row to reach its name field.
  await user.click(screen.getByRole('button', { name: /Nasi Lemak/ }));
  const nameField = screen.getByLabelText('Item name');
  await user.clear(nameField);
  await user.type(nameField, 'Nasi Lemak Special');

  const confirm = await screen.findByRole('button', { name: 'Confirm and continue' });
  await waitFor(() => assert.equal(confirm.disabled, false));
  await user.click(confirm);

  // Enter payment details, then create. The first create is refused as expired.
  await screen.findByText('How should people pay you?');
  const handle = screen.getByPlaceholderText(/DuitNow/);
  await user.type(handle, 'DuitNow: 012-3456789 (Test Owner)');
  await user.click(screen.getByRole('button', { name: 'Create the split' }));

  await signInThroughOverlay(user);

  await screen.findByText('Your split is ready 🎉');
  assert.equal(screen.queryByText('Start over'), null, 'the error screen must never appear');

  const creates = calls.filter((c) => c.url === '/api/v1/split' && c.method === 'POST');
  assert.equal(creates.length, 2, 'the create is retried exactly once after sign-in');
  assert.deepEqual(creates[1].body, creates[0].body, 'the retry submits the identical bill');
  assert.equal(creates[1].body.items[0].name, 'Nasi Lemak Special', 'the correction is in the submitted bill');
  assert.equal(creates[1].body.ownerPaymentHandle, 'DuitNow: 012-3456789 (Test Owner)');
});
