// src/screens/ParsingScreen.gate.test.jsx — Item 24 Step 6 Verify criteria:
// pax 1 shows only the optional stepper (no name rows, no toggle) and
// Review opens automatically when untouched; a touched gate never
// auto-advances and blocks Continue on an incomplete roster; a valid
// multi-person roster reaches Review with those names stored.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ParsingScreen.gate.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ParsingScreen from './ParsingScreen.jsx';
import { BillProvider, useBillActions, useBillState } from '../state/BillContext.jsx';

const SAMPLE_PARSED = { items: [], subtotal: 0, service_charge: 0, tax: 0, grand_total: 0 };

function Harness() {
  const { setParsed } = useBillActions();
  const { screen: current, payers } = useBillState();
  return (
    <>
      <span data-testid="current-screen">{current}</span>
      <span data-testid="payers">{payers.join(',')}</span>
      <button type="button" onClick={() => setParsed(SAMPLE_PARSED)}>
        finish scan
      </button>
      <ParsingScreen />
    </>
  );
}

function renderGate() {
  return render(
    <BillProvider>
      <Harness />
    </BillProvider>
  );
}

const currentScreen = () => screen.getByTestId('current-screen').textContent;
const finishScan = () => screen.getByRole('button', { name: 'finish scan' });

test.afterEach(() => cleanup());

test('G1: solo default shows only the optional stepper, no name rows, no toggle', () => {
  renderGate();
  assert.ok(screen.getByTestId('roster-gate'));
  assert.ok(screen.getByTestId('solo-helper'));
  assert.equal(screen.queryByTestId('name-rows'), null);
  assert.equal(screen.queryByTestId('claim-mode-toggle'), null);
});

test('G2: untouched gate auto-advances to review the moment the scan finishes', async () => {
  const user = userEvent.setup();
  renderGate();
  await user.click(finishScan());
  assert.equal(currentScreen(), 'review');
});

test('G3/G5/G6: touched gate never auto-advances; Continue is disabled until the scan is done, then enabled', async () => {
  const user = userEvent.setup();
  renderGate();
  await user.click(screen.getByLabelText('More people')); // touches the gate, people = 2
  assert.ok(screen.getByTestId('name-rows'));
  assert.ok(screen.getByTestId('claim-mode-toggle'));

  assert.equal(screen.getByRole('button', { name: 'Reading your receipt…' }).disabled, true);

  await user.click(finishScan());
  assert.notEqual(currentScreen(), 'review', 'a touched gate must not auto-advance');
  assert.ok(screen.getByRole('button', { name: 'Continue' }));
});

test('G7/G9/G11: incomplete roster blocks Continue with the spec copy, then a valid roster proceeds with those names stored', async () => {
  const user = userEvent.setup();
  renderGate();
  await user.click(screen.getByLabelText('More people')); // people = 2
  await user.click(finishScan());

  await user.click(screen.getByRole('button', { name: 'Continue' }));
  assert.match(screen.getByRole('alert').textContent, /Fix the names above to continue\./);
  assert.ok(screen.getByText('Add your name so friends know which one is you.'));

  await user.type(screen.getByLabelText('Your name'), 'Farah');
  await user.clear(screen.getByLabelText('Name for person 2'));
  await user.type(screen.getByLabelText('Name for person 2'), 'Ben');
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  assert.equal(currentScreen(), 'review');
  assert.equal(screen.getByTestId('payers').textContent, 'Farah,Ben');
});
