// src/screens/ReviewScreen.radix.test.jsx — Item 22 Step 8's Radix retrofit
// (this pass): tests for the three new-Radix-driven interactions
// ReviewScreen.jsx's header comment describes, none of which
// renderToStaticMarkup (payer-item-row.security.test.mjs's approach) or a
// pure-reducer test (bill-context-assignment.test.mjs's approach) can
// verify — all three need a live DOM, real keyboard events, and real
// browser focus:
//
//   1. Accordion block-on-collapse: closing an unresolved manual-mode row
//      is rejected and the row stays open (§5.1.1 point 4).
//   2. Real focus-stealing on that same block, replacing the first build's
//      aria-live-only simplification — the first ticked payer's amount
//      field actually receives DOM focus.
//   3. Segmented-control keyboard behaviour: Radix ToggleGroup's
//      roving-tabindex arrow-key navigation between the two options.
//
// Uses src/test/jsdom-setup.mjs (live DOM) and src/test/register-jsx.mjs
// (JSX transform for `node --test`, since this is the first test in the
// repo to render a real .jsx screen component rather than a plain
// React.createElement file or a JSX-free reducer — see both those files'
// own header comments for why nothing before this pass needed either).
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.radix.test.jsx
// (wired into package.json's "test" script this pass. .jsx, not .mjs, since
// this file itself renders real JSX (<Harness />, <BillProvider>...) —
// register-jsx.mjs's loader only transforms the .jsx extension, matching
// the same extension-as-signal convention ReviewScreen.jsx itself already
// uses to mean "contains real JSX" vs. payer-item-row.js's plain
// React.createElement, JSX-free .js sibling.)
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';

// Seeds a single-item, single-payer ('Me', the default payer) bill via the
// real reducer actions (not a state prop — BillProvider takes none, by
// design; every screen only ever reads/writes through useBillState /
// useBillActions, and this harness does the same rather than reaching
// around it) before rendering the real ReviewScreen. Mirrors CaptureScreen's
// real setParsed() call, just fired from an effect instead of a network
// response.
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

async function expandChickenRiceRow(user) {
  const trigger = screen.getByRole('button', { name: /Chicken Rice/ });
  await user.click(trigger);
  return trigger;
}

test.afterEach(() => {
  cleanup();
});

test('accordion: collapsing an unresolved manual-mode row is blocked, row stays open', async () => {
  const user = userEvent.setup();
  renderReviewScreen();

  const trigger = await expandChickenRiceRow(user);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  await user.click(screen.getByRole('radio', { name: 'Set amounts' }));

  // Nobody has typed a manual value yet — RM10.00 remains unallocated, so
  // this row is unresolved (isItemResolved() false) and closing it must be
  // rejected by handleAccordionChange's controlled `value`.
  await user.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true', 'row must stay open when blocked');

  const alert = screen.getByRole('alert');
  assert.match(alert.textContent, /RM 10\.00 still to allocate/);
  assert.match(alert.textContent, /Shares must total RM 10\.00/);
});

test('focus management: blocking on collapse moves real DOM focus to the first unresolved amount field', async () => {
  const user = userEvent.setup();
  renderReviewScreen();

  const trigger = await expandChickenRiceRow(user);
  await user.click(screen.getByRole('radio', { name: 'Set amounts' }));

  const amountInput = screen.getByLabelText("Me's amount for Chicken Rice");
  assert.notEqual(document.activeElement, amountInput, 'sanity check: not focused before the block fires');

  await user.click(trigger); // attempt to collapse while unresolved -> blocked

  assert.equal(
    document.activeElement,
    amountInput,
    'the first ticked payer\'s amount field must receive real focus when the block fires'
  );
});

test('focus management: filling the field to fully allocate clears the block and allows collapse', async () => {
  const user = userEvent.setup();
  renderReviewScreen();

  const trigger = await expandChickenRiceRow(user);
  await user.click(screen.getByRole('radio', { name: 'Set amounts' }));
  await user.click(trigger); // blocked
  assert.ok(screen.getByRole('alert'));

  const amountInput = screen.getByLabelText("Me's amount for Chicken Rice");
  await user.clear(amountInput);
  await user.type(amountInput, '10.00');

  // Fully allocated now — the block clears (role flips back to "status").
  assert.equal(screen.queryByRole('alert'), null);
  assert.match(screen.getByRole('status').textContent, /Fully allocated/);

  await user.click(trigger); // now succeeds
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('segmented control: ToggleGroup renders a single-select radiogroup with roving-tabindex arrow-key navigation', async () => {
  const user = userEvent.setup();
  renderReviewScreen();
  await expandChickenRiceRow(user);

  const equalOption = screen.getByRole('radio', { name: 'Equal split' });
  const manualOption = screen.getByRole('radio', { name: 'Set amounts' });

  assert.equal(equalOption.getAttribute('aria-checked'), 'true');
  assert.equal(manualOption.getAttribute('aria-checked'), 'false');

  equalOption.focus();
  assert.equal(document.activeElement, equalOption);

  await user.keyboard('{ArrowRight}');
  assert.equal(document.activeElement, manualOption, 'ArrowRight must move roving focus to the next option');

  await user.keyboard('{Enter}');
  assert.equal(manualOption.getAttribute('aria-checked'), 'true', 'Enter must activate the focused option');
  assert.equal(equalOption.getAttribute('aria-checked'), 'false');
});

test('segmented control: RM/% unit toggle is also a Radix single-select radiogroup', async () => {
  const user = userEvent.setup();
  renderReviewScreen();
  await expandChickenRiceRow(user);
  await user.click(screen.getByRole('radio', { name: 'Set amounts' }));

  const rmOption = screen.getByRole('radio', { name: 'RM' });
  const pctOption = screen.getByRole('radio', { name: '%' });
  assert.equal(rmOption.getAttribute('aria-checked'), 'true');

  rmOption.focus();
  await user.keyboard('{ArrowRight}');
  assert.equal(document.activeElement, pctOption);
  await user.keyboard('[Space]');
  assert.equal(pctOption.getAttribute('aria-checked'), 'true');
  assert.equal(rmOption.getAttribute('aria-checked'), 'false');
});
