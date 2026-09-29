// src/screens/ReviewScreen.claimmode.test.jsx — Item 24 Step 6, F3: in
// claimMode 'payers', ReviewScreen must (a) never auto-assign an item to
// everyone, and (b) let Confirm proceed with items left fully unclaimed.
// In claimMode 'host' (the default), behaviour is unchanged from before
// this item (every item still defaults to "everyone ticked").
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.claimmode.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions, useBillState } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';

const item = { name: 'Teh Tarik', category: 'drink', qty: 1, unit_price: 5, line_total: 5 };

function renderWith(claimMode) {
  function Harness() {
    const { setParsed, setClaimMode } = useBillActions();
    const { screen: current } = useBillState();
    useEffect(() => {
      setClaimMode(claimMode);
      setParsed({ items: [item], subtotal: 5, service_charge: 0, tax: 0, grand_total: 5 });
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
const currentScreen = () => screen.getByTestId('current-screen').textContent;

test.afterEach(() => cleanup());

test("claimMode 'payers': Confirm is enabled with the item still fully unclaimed, and reads 'Not yet claimed'", async () => {
  renderWith('payers');
  assert.ok(screen.getByText('Not yet claimed'));
  assert.equal(confirm().disabled, false);
});

test("claimMode 'payers': Confirm proceeds to payment leaving the item unassigned", async () => {
  const user = userEvent.setup();
  renderWith('payers');
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
});

test("claimMode 'host' (default): unchanged — item still defaults to everyone ticked", async () => {
  renderWith('host');
  assert.ok(screen.getByText('Split 1 ways'));
});
