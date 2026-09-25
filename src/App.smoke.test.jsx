// src/App.smoke.test.jsx — Item 22 Step 11: the full-path smoke test,
// §22.4's own words: "Capture -> parse -> review -> assign -> payment
// handle -> create -> share -> open the share link in a private window
// with no session. Plus a real phone on a real mobile connection. Verify:
// everything, and specifically that the share link generated before the
// migration still opens correctly after it."
//
// WHAT THIS FILE DOES AND HONESTLY DOES NOT COVER: this drives the entire
// path through the real, rendered React app (App.jsx -> every screen ->
// BillContext's real reducer -> js/totals.js's real money math), with
// `fetch` mocked at the network boundary to stand in for the three real
// serverless endpoints. That proves the client-side path end to end. It
// does NOT prove two things the doc's own verify line explicitly asks
// for, because neither is available to an automated local test run in
// this dispatch:
//   1. "On a Vercel preview" — requires a deployed preview URL, which
//      requires a git push. This dispatch is local-commit-only per Alex's
//      explicit scope for this task; no push happened.
//   2. "A real phone on a real mobile connection" — requires physical
//      hardware this environment does not have.
// Both gaps are reported as open blockers in this pass's dispatch report,
// not silently presented as covered by this file. What IS proven here
// still has real value: it's the strongest LOCAL equivalent available,
// and it catches any wiring/logic break in the migrated client itself,
// which is the thing most likely to actually break.
//
// "The share link generated before the migration still opens correctly
// after it" — the strongest local equivalent available: PayerScreen.jsx
// (unchanged behaviourally since Item 22 Step 6, per that file's own
// header comment) is exercised here against a `getSplit()` response shaped
// exactly like the one the OLD vanilla client's own /api/split endpoint
// already returns (unchanged field names/shapes — Item 22 Step 3 only
// added the /api/v1/* rewrite, it did not touch api/split.js's response
// shape). This proves the React payer view correctly renders that
// unchanged contract; it does not literally open a link that was created
// by a pre-migration deployment (there isn't one available to this local
// test run).
import { window as jsdomWindow } from '../src/test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';

// CaptureScreen.jsx (real production code, unmocked here) uses the native
// FileReader API to turn the uploaded photo into a data URL — jsdom-setup.mjs
// doesn't forward it by default (no prior test needed it), so it's added
// here, scoped to this smoke test only, rather than widening the shared
// setup file for every other test's environment.
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

const CREATED_SPLIT = {
  id: 'smoketest123',
  url: '/s/smoketest123',
};

// Matches what api/split.js (unchanged since before Item 22 — Step 3 only
// adds the /api/v1/* rewrite, per that step's own header comment in
// ReviewScreen.jsx and the doc's V2 decision) actually returns for a
// GET — items + totals.per_person + ownerPaymentHandle, the exact shape
// PayerScreen.jsx (Step 6) reads.
const STORED_SPLIT = {
  items: PARSED_RECEIPT.items,
  totals: {
    subtotal: PARSED_RECEIPT.subtotal,
    service_charge: PARSED_RECEIPT.service_charge,
    tax: PARSED_RECEIPT.tax,
    grand_total: PARSED_RECEIPT.grand_total,
    per_person: { Me: 12.18 },
  },
  ownerPaymentHandle: 'DuitNow: 012-3456789 (Test Owner)',
};

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/api/v1/parse')) {
      return { ok: true, json: async () => PARSED_RECEIPT };
    }
    if (String(url).startsWith('/api/v1/split?')) {
      return { ok: true, json: async () => STORED_SPLIT };
    }
    if (String(url) === '/api/v1/split' && options?.method === 'POST') {
      return { ok: true, json: async () => CREATED_SPLIT };
    }
    throw new Error(`smoke test: unexpected fetch call to ${url}`);
  };
  return calls;
}

// jsdom's FileReader needs a real File-like Blob; a 1x1 GIF's bytes are
// enough — CaptureScreen only reads it as a data URL and forwards the
// base64 payload to the (mocked) parseReceipt(), it never decodes the
// image itself.
function makeFakeReceiptFile() {
  const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  // Must be jsdom's OWN File class, not Node's built-in global File — jsdom's
  // FileReader implementation validates its argument against its own
  // internal Blob wrapper and rejects a Node-native File instance even
  // though both are spec-shaped "File" objects.
  return new jsdomWindow.File([bytes], 'receipt.jpg', { type: 'image/jpeg' });
}

test.afterEach(() => {
  cleanup();
  delete globalThis.fetch;
});

test('full creator path: landing -> capture -> parse -> review -> payment -> create -> share', async () => {
  const calls = mockFetch();
  const user = userEvent.setup();

  render(<App />);

  // --- Landing: consent gate ---
  const consentCheckbox = screen.getByRole('checkbox');
  await user.click(consentCheckbox);
  await user.click(screen.getByRole('button', { name: 'Start a new split' }));

  // --- Capture: upload a receipt photo, triggers parseReceipt() ---
  const fileInput = screen.getByLabelText('Upload receipt photo', { selector: 'input' });
  const file = makeFakeReceiptFile();
  await user.upload(fileInput, file);

  // --- Review (post-parse): default equal-split assignment already
  //     resolves both items to the single default payer ('Me') ---
  await screen.findByText('Check the items');
  assert.ok(screen.getByText('Nasi Lemak'), 'parsed item 1 must render');
  assert.ok(screen.getByText('Teh Tarik'), 'parsed item 2 must render');

  const confirmButton = await screen.findByRole('button', { name: 'Confirm and continue' });
  await waitFor(() => assert.equal(confirmButton.disabled, false, 'default equal-split assignment must already be confirmable'));
  await user.click(confirmButton);

  // --- Payment handle entry ---
  await screen.findByText('How should people pay you?');
  const handleField = screen.getByPlaceholderText(/DuitNow/);
  await user.type(handleField, 'DuitNow: 012-3456789 (Test Owner)');
  await user.click(screen.getByRole('button', { name: 'Create the split' }));

  // --- Creating -> Share (createSplit() resolves) ---
  await screen.findByText('Your split is ready 🎉');
  const shareLinkField = screen.getByDisplayValue(/\/s\/smoketest123$/);
  assert.ok(shareLinkField, 'the created share URL must render in the share screen');

  // --- Confirm the full network contract was exercised in order ---
  const parseCalls = calls.filter((c) => c.url.includes('/api/v1/parse'));
  const createCalls = calls.filter((c) => c.url === '/api/v1/split' && c.options?.method === 'POST');
  assert.equal(parseCalls.length, 1, 'parseReceipt() must be called exactly once');
  assert.equal(createCalls.length, 1, 'createSplit() must be called exactly once');

  // The confirm-time payload actually submitted must carry the exact
  // grand total the review screen showed — this is the money-safety
  // property Item 21/22 exist to guarantee, re-confirmed here end to end.
  const submittedBody = JSON.parse(createCalls[0].options.body);
  assert.equal(submittedBody.totals.grand_total, PARSED_RECEIPT.grand_total);
  assert.equal(submittedBody.ownerPaymentHandle, 'DuitNow: 012-3456789 (Test Owner)');
  assert.deepEqual(submittedBody.payers, ['Me'], 'the ordered payers list must be sent to the server');
});

test('opening the share link fresh (no prior app state — "a private window with no session") renders the payer view from the stored split alone', async () => {
  mockFetch();
  window.history.pushState(null, '', '/s/smoketest123');

  render(<App />);

  await screen.findByText('Bill split');
  assert.ok(screen.getByText('Nasi Lemak'));
  assert.ok(screen.getByText('Teh Tarik'));
  assert.match(screen.getByText('Who owes what').closest('div').textContent, /RM12\.18/);
  assert.match(
    screen.getByText('Pay the bill owner').closest('div').textContent,
    /DuitNow: 012-3456789 \(Test Owner\)/
  );

  window.history.pushState(null, '', '/');
});
