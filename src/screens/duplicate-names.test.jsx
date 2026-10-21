// Two people with the same name: the roster step and the Review People row.
// The text the host typed is never rewritten; the clash is flagged under both
// boxes once they leave a box or tap forward, every way forward is blocked,
// and no per-item control can act on the wrong person while it lasts.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/duplicate-names.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ParsingScreen from './ParsingScreen.jsx';
import ReviewScreen from './ReviewScreen.jsx';
import { BillProvider, useBillActions, useBillState } from '../state/BillContext.jsx';

const BILL = {
  items: [
    { name: 'Teh Tarik', category: 'drink', qty: 1, unit_price: 5, line_total: 5 },
    { name: 'Roti Canai', category: 'food', qty: 1, unit_price: 3, line_total: 3 },
  ],
  subtotal: 8,
  service_charge: 0,
  tax: 0,
  grand_total: 8,
};

const CLASH = (name) => `Two people are called '${name}'. Give each a different name.`;

test.afterEach(() => cleanup());

// --- the scan-wait roster step ----------------------------------------

function renderGate() {
  function Harness() {
    const { setParsed } = useBillActions();
    const { screen: current, payers } = useBillState();
    return (
      <>
        <span data-testid="current-screen">{current}</span>
        <span data-testid="payers">{JSON.stringify(payers)}</span>
        <button type="button" onClick={() => setParsed(BILL)}>
          finish scan
        </button>
        <ParsingScreen />
      </>
    );
  }
  return render(
    <BillProvider>
      <Harness />
    </BillProvider>
  );
}

const gateScreen = () => screen.getByTestId('current-screen').textContent;
const gatePayers = () => JSON.parse(screen.getByTestId('payers').textContent);
const nameBox = (n) => screen.getByLabelText(n === 1 ? 'Your name' : `Name for person ${n}`);

async function gateWithTwo(user, first, second) {
  renderGate();
  await user.click(screen.getByLabelText('More people'));
  await user.click(screen.getByRole('button', { name: 'finish scan' }));
  await user.clear(nameBox(1));
  await user.type(nameBox(1), first);
  await user.clear(nameBox(2));
  await user.type(nameBox(2), second);
}

test('D3: while typing a clashing name nothing is flagged and the text stays exactly as typed', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Farah', 'Be');
  await user.clear(nameBox(1));
  await user.type(nameBox(1), 'Ben');
  await user.click(nameBox(2));
  await user.type(nameBox(2), 'n'); // "Ben" now clashes, box 2 still has focus
  assert.equal(nameBox(2).value, 'Ben');
  assert.equal(screen.queryByText(CLASH('Ben')), null, 'no message mid-typing');
  assert.equal(nameBox(2).getAttribute('aria-invalid'), null);
});

test('D4/D5: leaving the box flags BOTH boxes; fixing it clears both at once', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ben', 'ben');
  await user.tab(); // leave box 2
  assert.equal(screen.getAllByText(CLASH('ben')).length + screen.getAllByText(CLASH('Ben')).length, 2);
  assert.equal(nameBox(1).getAttribute('aria-invalid'), 'true');
  assert.equal(nameBox(2).getAttribute('aria-invalid'), 'true');
  assert.ok(nameBox(1).getAttribute('aria-describedby'));
  assert.equal(nameBox(1).value, 'Ben', 'text kept as typed');
  assert.equal(nameBox(2).value, 'ben', 'text kept as typed');

  await user.clear(nameBox(2));
  await user.type(nameBox(2), 'Bea');
  assert.equal(nameBox(1).getAttribute('aria-invalid'), null);
  assert.equal(nameBox(2).getAttribute('aria-invalid'), null);
  assert.equal(screen.queryByText(/Two people are called/), null);
});

test('D4: tapping the stepper also flags the clash', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ben', 'Ben');
  assert.equal(screen.queryByText(CLASH('Ben')), null, 'still typing in box 2: nothing yet');
  await user.click(screen.getByLabelText('More people'));
  assert.equal(screen.getAllByText(CLASH('Ben')).length, 2);
});

test('D1: Continue is blocked while two names clash, for every look-alike form, and nothing moves on', async () => {
  for (const [a, b] of [
    ['Ben', 'ben'],
    ['Ben Tan', 'Ben  Tan'],
    ['Ben', ' Ben '],
    ['Ben', 'Ｂｅｎ'],
  ]) {
    const user = userEvent.setup();
    await gateWithTwo(user, a, b);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    assert.notEqual(gateScreen(), 'review', JSON.stringify([a, b]));
    assert.match(screen.getByRole('alert').textContent, /Fix the names above to continue\./);
    assert.equal(nameBox(1).getAttribute('aria-invalid'), 'true');
    assert.equal(nameBox(2).getAttribute('aria-invalid'), 'true');
    cleanup();
  }
});

test('D1/D5: after the fix Continue goes forward', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ben', 'Ben');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  assert.notEqual(gateScreen(), 'review');
  await user.clear(nameBox(2));
  await user.type(nameBox(2), 'Bea');
  assert.equal(screen.queryByRole('alert'), null, 'summary clears as soon as it is fixed');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  assert.equal(gateScreen(), 'review');
  assert.deepEqual(gatePayers(), ['Ben', 'Bea']);
});

test('D11/ED-5: a hidden character is removed on leaving the box, then it counts as the same name', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ben', 'Bea');
  await user.clear(nameBox(2));
  await user.type(nameBox(2), 'Ben​');
  await user.tab();
  assert.equal(nameBox(2).value, 'Ben', 'hidden character stripped');
  assert.equal(screen.getAllByText(CLASH('Ben')).length, 2);
});

test('ED-2/ED-3: only the clashing boxes are marked; all three when all match', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ana', 'Ben');
  await user.click(screen.getByLabelText('More people'));
  await user.clear(nameBox(3));
  await user.type(nameBox(3), 'BEN');
  await user.tab();
  assert.equal(nameBox(1).getAttribute('aria-invalid'), null, 'the third person is clean');
  assert.equal(nameBox(2).getAttribute('aria-invalid'), 'true');
  assert.equal(nameBox(3).getAttribute('aria-invalid'), 'true');
  await user.clear(nameBox(1));
  await user.type(nameBox(1), 'ben');
  await user.tab();
  assert.equal(nameBox(1).getAttribute('aria-invalid'), 'true');
});

test('ED-4: removing one of the clashing people clears the clash', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ana', 'Ben');
  await user.click(screen.getByLabelText('More people'));
  await user.clear(nameBox(3));
  await user.type(nameBox(3), 'Ben');
  await user.tab();
  assert.equal(screen.getAllByText(CLASH('Ben')).length, 2);
  await user.click(screen.getByLabelText('Fewer people'));
  assert.equal(screen.queryByText(/Two people are called/), null);
  assert.deepEqual(gatePayers(), ['Ana', 'Ben']);
});

test('D8: a new "Person N" label skips a name typed in another letter case', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ana', 'person 3');
  await user.click(screen.getByLabelText('More people'));
  assert.equal(nameBox(3).value, 'Person 4');
  assert.deepEqual(gatePayers(), ['Ana', 'person 3', 'Person 4']);
});

test('D12: a blank name at 2+ people still blocks Continue', async () => {
  const user = userEvent.setup();
  await gateWithTwo(user, 'Ana', 'Ben');
  await user.clear(nameBox(2));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  assert.notEqual(gateScreen(), 'review');
  assert.ok(screen.getByText('Add a name for person 2.'));
});

test('D13: one person alone is never checked', async () => {
  const user = userEvent.setup();
  renderGate();
  await user.click(screen.getByRole('button', { name: 'finish scan' }));
  assert.equal(gateScreen(), 'review');
});

test('ED-6: solo "Me", then adding people and typing "me" for another is a clash', async () => {
  const user = userEvent.setup();
  renderGate();
  await user.click(screen.getByLabelText('More people'));
  await user.click(screen.getByRole('button', { name: 'finish scan' }));
  await user.type(nameBox(1), 'me');
  await user.clear(nameBox(2));
  await user.type(nameBox(2), 'ME');
  await user.tab();
  assert.equal(screen.getAllByText(/Two people are called/).length, 2);
});

// --- the Review "People" row ------------------------------------------

function renderReview({ extraPeople = [] } = {}) {
  function Harness() {
    const { setParsed, addPayer } = useBillActions();
    const { screen: current, payers, assignments } = useBillState();
    useEffect(() => {
      extraPeople.forEach((name) => addPayer(name));
      setParsed(BILL);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
    }, []);
    return (
      <>
        <span data-testid="current-screen">{current}</span>
        <span data-testid="stored-payers">{JSON.stringify(payers)}</span>
        <span data-testid="stored-assignments">{JSON.stringify(assignments)}</span>
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

const reviewScreen = () => screen.getByTestId('current-screen').textContent;
const storedAssignments = () => JSON.parse(screen.getByTestId('stored-assignments').textContent);
const trigger = () => screen.getByRole('button', { name: /^People: \d+, .*(Edit|Done)/ });
const confirm = () => screen.getByRole('button', { name: 'Confirm and continue' });
const panel = () => screen.getByRole('group', { name: 'Edit people' });
const doneBtn = () => within(panel()).getByRole('button', { name: 'Done' });

test('D6: the grey line names the problem live, before any tap, and Confirm stays tappable', async () => {
  renderReview({ extraPeople: ['Ben'] });
  const user = userEvent.setup();
  assert.equal(screen.queryByTestId('roster-block-reason'), null, 'no clash yet');
  await user.click(trigger());
  await user.clear(screen.getByLabelText('Your name'));
  await user.type(screen.getByLabelText('Your name'), 'ben');
  assert.equal(screen.getByTestId('roster-block-reason').textContent, 'Two people have the same name.');
  assert.equal(confirm().disabled, false);
  await user.clear(screen.getByLabelText('Your name'));
  await user.type(screen.getByLabelText('Your name'), 'Cy');
  assert.equal(screen.queryByTestId('roster-block-reason'), null, 'clears once fixed');
});

test('D6/D1/D4: Confirm on a clash stays on Review, opens People, flags both boxes and focuses the first', async () => {
  renderReview({ extraPeople: ['Ben'] });
  const user = userEvent.setup();
  await user.click(trigger());
  await user.clear(screen.getByLabelText('Your name'));
  await user.type(screen.getByLabelText('Your name'), 'Ben  ');
  await user.click(doneBtn());
  assert.equal(trigger().getAttribute('aria-expanded'), 'true', 'Done is blocked and People stays open');
  await user.click(confirm());
  assert.notEqual(reviewScreen(), 'payment');
  assert.equal(screen.getAllByText(CLASH('Ben')).length, 2);
  assert.equal(document.activeElement, screen.getByLabelText('Your name'));
});

test('D1: Done is blocked for an inner-space look-alike', async () => {
  renderReview({ extraPeople: ['Ben Tan'] });
  const user = userEvent.setup();
  await user.click(trigger());
  await user.clear(screen.getByLabelText('Your name'));
  await user.type(screen.getByLabelText('Your name'), 'Ben   Tan');
  await user.click(doneBtn());
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');
  assert.equal(screen.getAllByText(CLASH('Ben Tan')).length, 2);
});

test('D7: while two people share a name their per-item controls are off, with the note; nothing changes', async () => {
  renderReview({ extraPeople: ['Ben', 'Cy'] });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Teh Tarik/ }));
  assert.equal(screen.queryByTestId('name-clash-note'), null, 'no note without a clash');
  await user.click(trigger());
  await user.clear(screen.getByLabelText('Name for person 3'));
  await user.type(screen.getByLabelText('Name for person 3'), 'BEN');
  assert.equal(screen.getByTestId('name-clash-note').textContent, 'Fix the matching names first.');

  const before = JSON.stringify(storedAssignments());
  const benBoxes = screen.getAllByRole('checkbox', { name: /Include (Ben|BEN)/ });
  assert.equal(benBoxes.length, 2);
  benBoxes.forEach((box) => assert.equal(box.disabled, true));
  assert.equal(screen.getByRole('checkbox', { name: 'Include Me' }).disabled, false, 'the clean person stays usable');
  await user.click(benBoxes[0]);
  assert.equal(JSON.stringify(storedAssignments()), before, 'nothing attached to the wrong person');

  const equalBtn = screen.getByRole('radio', { name: 'Equal split' });
  const amountsBtn = screen.getByRole('radio', { name: 'Set amounts' });
  assert.equal(equalBtn.disabled, true);
  assert.equal(amountsBtn.disabled, true);
  await user.click(amountsBtn);
  assert.equal(JSON.stringify(storedAssignments()), before, 'mode did not change');
});

test('D7/D5: the controls come back the moment the clash is fixed, with the ticks intact', async () => {
  renderReview({ extraPeople: ['Ben', 'Cy'] });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Teh Tarik/ }));
  await user.click(trigger());
  await user.clear(screen.getByLabelText('Name for person 3'));
  await user.type(screen.getByLabelText('Name for person 3'), 'ben');
  await user.clear(screen.getByLabelText('Name for person 3'));
  await user.type(screen.getByLabelText('Name for person 3'), 'Cyrus');
  assert.equal(screen.queryByTestId('name-clash-note'), null);
  const cyrus = screen.getAllByRole('checkbox', { name: 'Include Cyrus' })[0];
  assert.equal(cyrus.disabled, false);
  assert.equal(cyrus.checked, true, 'Cy kept their tick through the clash and the rename');
});

test('D1: Confirm goes forward once the names are different', async () => {
  renderReview({ extraPeople: ['Ben'] });
  const user = userEvent.setup();
  await user.click(trigger());
  await user.clear(screen.getByLabelText('Your name'));
  await user.type(screen.getByLabelText('Your name'), 'Ben');
  await user.click(confirm());
  assert.notEqual(reviewScreen(), 'payment');
  await user.clear(screen.getByLabelText('Your name'));
  await user.type(screen.getByLabelText('Your name'), 'Cy');
  await user.click(confirm());
  assert.equal(reviewScreen(), 'payment');
});
