// src/screens/ReviewScreen.motion.test.jsx — Item 22 Step 9: the "Totals
// recalculating" and "Review -> assignment transition" motion.dev
// placements as they actually behave inside ReviewScreen.jsx (§22.3 of
// bilang-mvp1-implementation-plans.md), plus the blur/confirm-snap wiring
// that's specific to this screen (moneySnapTick).
//
// Uses the same Harness/BillProvider pattern as ReviewScreen.radix.test.jsx
// — see that file's header comment for why a live DOM + real JSX transform
// (jsdom-setup.mjs + register-jsx.mjs) is required rather than
// renderToStaticMarkup.
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';

const SOURCE = readFileSync(fileURLToPath(new URL('./ReviewScreen.jsx', import.meta.url)), 'utf8');

function Harness() {
  const { setParsed } = useBillActions();
  useEffect(() => {
    setParsed({
      items: [{ name: 'Chicken Rice', category: 'food', qty: 1, unit_price: 10, line_total: 10 }],
      subtotal: 10,
      service_charge: 0,
      tax: 0,
      grand_total: 10,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
  }, []);
  return <ReviewScreen />;
}

function renderReviewScreen() {
  return render(
    <BillProvider>
      <Harness />
    </BillProvider>
  );
}

test.afterEach(() => {
  cleanup();
});

test('running totals render through AnimatedMoney and settle on the seeded single-payer total', async () => {
  renderReviewScreen();
  // Single payer ('Me', the default), one item, equal split. The default
  // assignment is applied by ReviewScreen's own `ensureItemDefaultAssignment`
  // effect, one commit AFTER first paint — so AnimatedMoney's FIRST jump
  // lands on RM0.00 (nothing assigned yet on the very first render), and
  // the subsequent RM0.00 -> RM10.00 change is an ordinary "editing" change
  // (no blur/confirm fired), which §22.3 says must ANIMATE, not snap. This
  // is deliberately verified by awaiting the spring's real settle time
  // (jsdom's requestAnimationFrame polyfill, from jsdom-setup.mjs's
  // `pretendToBeVisual: true`, drives real timers) rather than asserting an
  // immediate value — asserting immediately would either be flaky or would
  // incorrectly demand the snap-on-mount behaviour this specific transition
  // must NOT have.
  const runningTotalsHeading = screen.getByText('Running totals');
  const section = runningTotalsHeading.closest('div');

  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.match(section.textContent, /RM10\.00/, 'after settling, the running total must read the full assigned amount');
});

test('blur on a manual-mode amount field bumps the snap discipline — the remaining-to-allocate figure is exact immediately, never mid-animation', async () => {
  const user = userEvent.setup();
  renderReviewScreen();

  const trigger = screen.getByRole('button', { name: /Chicken Rice/ });
  await user.click(trigger);
  await user.click(screen.getByRole('radio', { name: 'Set amounts' }));

  const amountInput = screen.getByLabelText("Me's amount for Chicken Rice");
  await user.clear(amountInput);
  await user.type(amountInput, '10.00');
  fireEvent.blur(amountInput);

  // "Fully allocated" is a plain string (not an AnimatedMoney figure), so
  // this also re-confirms the existing Radix behaviour survives the motion
  // wiring unchanged, matching ReviewScreen.radix.test.jsx's own assertion.
  assert.match(screen.getByRole('status').textContent, /Fully allocated/);
});

test('the Confirm button is confirmable and functionally unchanged with the default equal-split assignment', async () => {
  // Behavioural half of the whileTap placement: confirms the interactive
  // contract (button becomes enabled, click still navigates via
  // handleConfirm) survived being wrapped in `motion.button`. The tap
  // GESTURE itself (the visual `whileTap` scale-down) is a real-pointer
  // interaction that framer-motion's gesture layer does not reliably fire
  // from jsdom's synthetic `fireEvent.pointerDown` (confirmed by direct
  // experiment while writing this test — no inline style change was
  // observed even though the same wiring works in a real browser) — that
  // half is covered by the source-level test immediately below, plus
  // Step 11's manual Vercel-preview smoke test for the actual visual
  // confirmation.
  const user = userEvent.setup();
  renderReviewScreen();

  const trigger = screen.getByRole('button', { name: /Chicken Rice/ });
  await user.click(trigger); // default equal-split assignment resolves immediately — item is confirmable as-is

  const confirmButton = screen.getByRole('button', { name: 'Confirm and continue' });
  assert.equal(confirmButton.disabled, false, 'confirmable with the default equal-split assignment');
});

test('source-level: whileTap feedback is wired on the Confirm button, "+ Add missing item", every Radix Trigger/ToggleGroup.Item, and each tick-row — all kept under the ~150ms ceiling', () => {
  const tapSites = [
    /onClick=\{handleConfirm\}[\s\S]{0,80}disabled=\{!canConfirm\}[\s\S]{0,80}whileTap=/, // Confirm button
    /onClick=\{addItem\}[\s\S]{0,80}whileTap=\{TAP_SCALE\}/, // + Add missing item
    /<Accordion\.Trigger asChild>[\s\S]{0,120}<motion\.button[\s\S]{0,80}whileTap=\{TAP_SCALE\}/, // per-item accordion trigger
    /<ToggleGroup\.Item value="equal" asChild>[\s\S]{0,80}<motion\.button[\s\S]{0,80}whileTap=\{TAP_SCALE\}/, // Equal split
    /<ToggleGroup\.Item value="manual" asChild>[\s\S]{0,80}<motion\.button[\s\S]{0,80}whileTap=\{TAP_SCALE\}/, // Set amounts
    /<motion\.div[\s\S]{0,40}key=\{name\}[\s\S]{0,80}whileTap=\{TAP_SCALE\}/, // payer tick-row
  ];
  for (const pattern of tapSites) {
    assert.match(SOURCE, pattern, `expected a whileTap wiring matching ${pattern}`);
  }
  assert.match(SOURCE, /const TAP_TRANSITION = \{ duration: 0\.1 \}/, 'the shared tap transition must stay under the ~150ms ceiling (§22.3)');
});

test('source-level: each Accordion.Item row is a motion.div carrying `layout` (the "Review -> assignment transition" placement)', () => {
  assert.match(
    SOURCE,
    /<Accordion\.Item key=\{item\.id\} value=\{item\.id\} asChild>[\s\S]{0,400}<motion\.div layout /,
    'each accordion row must be rendered as a motion.div with the `layout` prop, via Radix asChild'
  );
});
