// src/App.item10.fullpath.test.jsx — Item 10 Checkpoint 4, Step 12: the
// full-path test as plans §10.4 Step 12 specifies it.
//
//   "Sign in, scan, correct, assign, create, share, open the share link in a
//    private window with no session. Verify: the share link renders for an
//    anonymous viewer, and the new split row carries a non-null account_id."
//
// WHAT THIS PROVES, AND WHAT IT CANNOT PROVE
// - Proven here: the whole client path runs in order, the sign-in comes first,
//   every request goes to /api/v1/ with same-origin credentials, the payer
//   link renders with no session check at all, and the submitted bill carries
//   the correction.
// - NOT proven here, because every network call is stubbed by design: the
//   non-null account_id in the database row. That is a server write. It is
//   covered by api/split.post.test.mjs (server-side, stubbed Supabase) and
//   must be confirmed on a Preview deployment with a real row before
//   go-live. A "share link opens in a private window" check also needs a real
//   browser on a deployed URL, which this file is not.
//
// Network: fully stubbed (src/test/fetch-stub.mjs). Nothing here reaches
// Supabase, Anthropic, Resend or any real host.
import { window as jsdomWindow } from './test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { installFetchStub, uninstallFetchStub, reply } from './test/fetch-stub.mjs';

globalThis.FileReader = jsdomWindow.FileReader;

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

const CREATED_SPLIT = { id: 'fullpath123', url: '/s/fullpath123' };

// The stored split as the anonymous GET returns it (unchanged contract).
const STORED_SPLIT = {
  items: [{ name: 'Nasi Lemak (large)', category: 'food', qty: 1, unit_price: 8, line_total: 8 }, PARSED_RECEIPT.items[1]],
  totals: {
    subtotal: PARSED_RECEIPT.subtotal,
    service_charge: PARSED_RECEIPT.service_charge,
    tax: PARSED_RECEIPT.tax,
    grand_total: PARSED_RECEIPT.grand_total,
    per_person: { Me: 12.18 },
  },
  ownerPaymentHandle: 'DuitNow: 012-3456789 (Test Owner)',
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

test('full path: sign in, scan, correct, assign, create, share, then open the link anonymously with no session', async () => {
  // Session is signed-out at first, so the sign-in comes before anything else.
  const calls = installFetchStub((call) => {
    if (call.url === '/api/v1/auth/session') return reply(200, { signedIn: false });
    if (call.url === '/api/v1/auth/request-code') return reply(204);
    if (call.url === '/api/v1/auth/verify-code') return reply(200, { accountId: 'acct-full' });
    if (call.url === '/api/v1/parse') return reply(200, PARSED_RECEIPT);
    if (call.url === '/api/v1/split' && call.method === 'POST') return reply(200, CREATED_SPLIT);
    if (call.url === '/api/v1/split?id=fullpath123') return reply(200, STORED_SPLIT);
    return undefined;
  });
  const user = userEvent.setup();
  render(<App />);

  // 1. Sign in: the page sign-in comes first, then the code.
  await user.type(await screen.findByLabelText('Email address'), 'ali@example.com');
  // Terms tick moved to the email step (Alex, 2026-10-10) — shown to every
  // user, every time, and required before the code can be sent. The Landing
  // screen's own consent checkbox has not been reached yet at this point.
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Send me a code' }));
  await user.type(await screen.findByLabelText('Six-digit code'), '424242');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  // 2. Landing (consent gate), then start.
  await user.click(await screen.findByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Start a new split' }));

  // 3. Scan.
  await user.upload(screen.getByLabelText('Upload receipt photo', { selector: 'input' }), fakeReceiptFile());
  await screen.findByText('Check the items');

  // 4. Correct one item name. Item rows start collapsed; open the first row.
  await user.click(screen.getByRole('button', { name: /Nasi Lemak/ }));
  const nameField = screen.getByLabelText('Item name');
  await user.clear(nameField);
  await user.type(nameField, 'Nasi Lemak (large)');

  // 5. Assign: the default equal split puts both items on the bill owner, so Confirm is enabled.
  const confirm = await screen.findByRole('button', { name: 'Confirm and continue' });
  await waitFor(() => assert.equal(confirm.disabled, false));
  await user.click(confirm);

  // 6. Payment handle, then create.
  await screen.findByText('How should people pay you?');
  await user.type(screen.getByPlaceholderText(/DuitNow/), 'DuitNow: 012-3456789 (Test Owner)');
  await user.click(screen.getByRole('button', { name: 'Create the split' }));

  // 7. Share.
  await screen.findByText('Your split is ready 🎉');
  assert.ok(screen.getByDisplayValue(/\/s\/fullpath123$/), 'the share link must be shown');

  // Every creator-side request went to the versioned API, same origin, and nothing else.
  for (const c of calls) {
    assert.ok(c.url.startsWith('/api/v1/'), `only /api/v1/ may be called, saw ${c.url}`);
    assert.equal(c.options.credentials, 'same-origin', `credentials must be same-origin on ${c.url}`);
  }
  const submitted = calls.find((c) => c.url === '/api/v1/split' && c.method === 'POST').body;
  assert.equal(submitted.items[0].name, 'Nasi Lemak (large)', 'the correction is in the submitted bill');
  assert.equal(submitted.totals.grand_total, PARSED_RECEIPT.grand_total);
  const sessionChecksBeforeShare = calls.filter((c) => c.url === '/api/v1/auth/session').length;
  assert.equal(sessionChecksBeforeShare, 1, 'the session is checked once, on load');

  // 8. Open the share link as an anonymous viewer: a fresh render, no session.
  cleanup();
  window.history.pushState(null, '', '/s/fullpath123');
  render(<App />);

  await screen.findByText('Bill split');
  assert.ok(screen.getByText('Nasi Lemak (large)'), 'the anonymous viewer sees the stored split');
  assert.match(
    screen.getByText('Pay the bill owner').closest('div').textContent,
    /DuitNow: 012-3456789 \(Test Owner\)/
  );
  assert.equal(screen.queryByLabelText('Email address'), null, 'the payer link shows no sign-in prompt');

  const sessionChecksTotal = calls.filter((c) => c.url === '/api/v1/auth/session').length;
  assert.equal(sessionChecksTotal, 1, 'the payer path must not check the session at all');
  const payerRead = calls.filter((c) => c.url === '/api/v1/split?id=fullpath123' && c.method === 'GET');
  assert.ok(payerRead.length >= 1, 'the anonymous read goes straight to the split (the payer view may poll)');
  assert.equal(payerRead[0].options.credentials, 'same-origin');
});
