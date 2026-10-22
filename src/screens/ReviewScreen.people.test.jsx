// The Review "People" row: view, edit, add and remove people, switch who picks.
//
// Run: node --import ./src/test/register-jsx.mjs --test src/screens/ReviewScreen.people.test.jsx
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { BillProvider, useBillActions, useBillState } from '../state/BillContext.jsx';
import ReviewScreen from './ReviewScreen.jsx';
import RosterGate from './RosterGate.jsx';
import PaymentScreen from './PaymentScreen.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';

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

// withPayment: also mount the real PaymentScreen (inside the real AuthProvider,
// with the network stubbed) so a test can go forward to it and Back.
function renderReview({ extraPeople = [], renames = [], claimMode = 'host', withPayment = false } = {}) {
  function Harness() {
    const { setParsed, addPayer, renamePayer, setClaimMode } = useBillActions();
    const { screen: current, payers } = useBillState();
    useEffect(() => {
      if (claimMode !== 'host') setClaimMode(claimMode);
      extraPeople.forEach((name) => addPayer(name));
      renames.forEach(([index, name]) => renamePayer(index, name)); // lets a test seed a name clash
      setParsed(BILL);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
    }, []);
    return (
      <>
        <span data-testid="current-screen">{current}</span>
        <span data-testid="stored-payers">{JSON.stringify(payers)}</span>
        {withPayment && current === 'payment' ? <PaymentScreen /> : <ReviewScreen />}
      </>
    );
  }
  const tree = (
    <BillProvider>
      <Harness />
    </BillProvider>
  );
  if (!withPayment) return render(tree);
  // The session check on mount must not touch the network.
  globalThis.fetch = () => new Promise(() => {});
  return render(<AuthProvider>{tree}</AuthProvider>);
}

const currentScreen = () => screen.getByTestId('current-screen').textContent;
const storedPayers = () => JSON.parse(screen.getByTestId('stored-payers').textContent);
const trigger = () => screen.getByRole('button', { name: /^People: \d+, .*(Edit|Done)/ });
const summary = () => screen.getByTestId('people-summary').textContent;
const confirm = () => screen.getByRole('button', { name: 'Confirm and continue' });
const panel = () => screen.getByRole('group', { name: 'Edit people' });
const openPeople = async (user) => user.click(trigger());
const done = (user) => user.click(within(panel()).getByRole('button', { name: 'Done' }));

test.afterEach(() => cleanup());

// --- collapsed row -----------------------------------------------------

test('AC-1/AC-2/AC-3: the People row is at the top for a solo bill, shows the host as You and offers Edit', () => {
  renderReview();
  assert.equal(summary(), 'People: 1 (You)');
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
  assert.match(trigger().getAttribute('aria-label'), /^People: 1, You\. Edit people\.$/);
  assert.equal(screen.getByTestId('people-row').textContent.includes('Edit'), true);
  assert.deepEqual(storedPayers(), ['Me'], 'the stored name is unchanged');
});

test('AC-1: the row sits above the item list', () => {
  renderReview();
  const row = screen.getByTestId('people-row');
  const firstItem = screen.getByRole('button', { name: /Teh Tarik/ });
  assert.ok(row.compareDocumentPosition(firstItem) & 4, 'item list comes after the People row');
});

test('AC-4: many people collapse to +N on a single truncating line', () => {
  renderReview({ extraPeople: ['Ben', 'Chloe', 'Dan', 'Eve', 'Fay'] });
  assert.equal(summary(), 'People: 6 (You, Ben, Chloe +3)');
  assert.match(screen.getByTestId('people-summary').className, /\btruncate\b/);
});

// --- opening and closing -----------------------------------------------

test('AC-6/NF-1: Edit opens the editor inline, exposes aria-expanded and moves focus into it', async () => {
  const user = userEvent.setup();
  renderReview();
  await openPeople(user);
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');
  assert.notEqual(currentScreen(), 'payment', 'no route change');
  assert.ok(screen.getByLabelText('How many people, including you?'));
  assert.ok(screen.getByTestId('solo-helper'));
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(panel().contains(document.activeElement) || panel() === document.activeElement);
});

test('NF-1: Done closes the editor and returns focus to the row', async () => {
  const user = userEvent.setup();
  renderReview();
  await openPeople(user);
  await done(user);
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, trigger());
});

test('AC-5: after editing, the collapsed summary shows the new count and names', async () => {
  const user = userEvent.setup();
  renderReview();
  await openPeople(user);
  await user.click(screen.getByLabelText('More people'));
  await user.type(screen.getByLabelText('Your name'), 'Alex');
  const second = screen.getByLabelText('Name for person 2');
  await user.clear(second);
  await user.type(second, 'Sam');
  await done(user);
  assert.equal(summary(), 'People: 2 (You, Sam)');
  assert.deepEqual(storedPayers(), ['Alex', 'Sam']);
});

// --- adding people (core path) -------------------------------------------

test('AC-9: going from 1 to 2 blanks the host name and prefills Person 2', async () => {
  const user = userEvent.setup();
  renderReview();
  await openPeople(user);
  await user.click(screen.getByLabelText('More people'));
  assert.equal(screen.getByLabelText('Your name').value, '');
  assert.equal(screen.getByLabelText('Name for person 2').value, 'Person 2');
});

test('AC-13: adding a person on a solo bill puts them on the untouched items, with a note saying so', async () => {
  const user = userEvent.setup();
  renderReview();
  assert.equal(screen.getAllByText('Split 1 ways').length, 2);
  await openPeople(user);
  await user.click(screen.getByLabelText('More people'));
  assert.equal(screen.getAllByText('Split 2 ways').length, 2);
  assert.equal(
    screen.getByTestId('roster-change-note').textContent,
    "Added Person 2. They're on every item you haven't changed yourself."
  );
});

test('E-2 (core path): solo, add a person, name both, choose everyone-picks without a prompt, continue', async () => {
  const user = userEvent.setup();
  renderReview();
  await openPeople(user);
  await user.click(screen.getByLabelText('More people'));
  await user.type(screen.getByLabelText('Your name'), 'Alex');
  await user.click(screen.getByRole('radio', { name: /Let everyone pick their own/ }));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null, 'nothing was hand-assigned: no prompt');
  await done(user);
  assert.equal(screen.getAllByText('Not yet claimed').length, 2);
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
});

test('AC-14: in everyone-picks, adding a person leaves items unclaimed', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'], claimMode: 'payers' });
  await openPeople(user);
  await user.click(screen.getByLabelText('More people'));
  assert.equal(screen.getAllByText('Not yet claimed').length, 2);
});

// --- validation (AC-8) ----------------------------------------------------

test('AC-8: with an invalid roster, Confirm is blocked, errors appear only now, the editor opens and focus goes to the bad field', async () => {
  const user = userEvent.setup();
  renderReview();
  await openPeople(user);
  await user.click(screen.getByLabelText('More people')); // host name is now blank
  assert.equal(screen.queryByText('Add your name so friends know which one is you.'), null, 'no red while typing');
  await done(user); // collapse is refused while invalid
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('Add your name so friends know which one is you.'));
  assert.equal(document.activeElement, screen.getByLabelText('Your name'));
  assert.equal(screen.getByLabelText('Your name').getAttribute('aria-invalid'), 'true');
  assert.ok(screen.getByText('Fix the names above to continue.'));
  assert.equal(screen.getByTestId('roster-block-reason').textContent, 'Finish the people list first.');
  await user.click(confirm());
  assert.notEqual(currentScreen(), 'payment');
});

test('AC-8: tapping Confirm with a blank person name blocks, shows the message and focuses that field', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openPeople(user);
  await user.clear(screen.getByLabelText('Name for person 2'));
  await user.click(confirm());
  assert.notEqual(currentScreen(), 'payment');
  assert.ok(screen.getByText('Add a name for person 2.'));
  assert.equal(document.activeElement, screen.getByLabelText('Name for person 2'));
});

test('E-5: a name matching another person (different case) is a duplicate', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openPeople(user);
  const host = screen.getByLabelText('Your name');
  await user.clear(host);
  await user.type(host, 'ben');
  await done(user);
  const messages = screen.getAllByText('Two people have the same name. Change one.');
  assert.equal(messages.length, 2);
});

test('AC-7: renaming a person keeps their place on the items', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openPeople(user);
  const second = screen.getByLabelText('Name for person 2');
  await user.clear(second);
  await user.type(second, 'Benny');
  assert.equal(screen.getAllByText('Split 2 ways').length, 2);
  // Ben's tick moved with the rename: untick Benny on the first item and it reads as one person.
  await done(user);
  await user.click(screen.getByRole('button', { name: /Teh Tarik/ }));
  const benny = screen.getAllByRole('checkbox', { name: /Benny/ })[0];
  assert.equal(benny.checked, true, 'Benny still carries the tick Ben had');
});

// --- removing people ------------------------------------------------------

test('AC-11/AC-15: the stepper removes the last person from every item and never goes below one', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openPeople(user);
  await user.click(screen.getByLabelText('Fewer people'));
  assert.deepEqual(storedPayers(), ['Me']);
  assert.equal(screen.getAllByText('Split 1 ways').length, 2);
  assert.equal(screen.getByLabelText('Fewer people').disabled, true);
  assert.match(screen.getByTestId('roster-change-note').textContent, /^Removed Ben from the bill and from every item\./);
});

test('AC-12: removing the only person on an item shows the existing no-one-assigned state and Confirm is blocked as before', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  // Take Me off the first item so only Ben is on it.
  await user.click(screen.getByRole('button', { name: /Teh Tarik/ }));
  await user.click(screen.getByLabelText('Include Me'));
  await openPeople(user);
  await user.click(screen.getByLabelText('Fewer people')); // Ben leaves
  assert.ok(screen.getByText('No one assigned yet'));
  assert.match(screen.getByTestId('roster-change-note').textContent, /1 item now needs someone assigned\./);
  assert.equal(confirm().disabled, true);
});

// --- switching who picks ----------------------------------------------------

async function handAssignFirstItem(user) {
  await user.click(screen.getByRole('button', { name: /Teh Tarik/ }));
  await user.click(screen.getByLabelText('Include Ben'));
}

test('AC-16/AC-18: with hand-assigned items, choosing everyone-picks asks first; Keep as is changes nothing', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await handAssignFirstItem(user);
  await openPeople(user);
  await user.click(screen.getByRole('radio', { name: /Let everyone pick their own/ }));
  const prompt = screen.getByTestId('mode-switch-confirm');
  assert.ok(within(prompt).getByText("This clears who you've assigned. Clear and switch?"));
  await user.click(within(prompt).getByRole('button', { name: 'Keep as is' }));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.ok(screen.getByText('Assigned: Me'), 'the hand-set item is still set');
  assert.equal(screen.queryByText('Not yet claimed'), null);
});

test('AC-16/AC-17: Clear and switch clears every assignment and tells the host', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await handAssignFirstItem(user);
  await openPeople(user);
  await user.click(screen.getByRole('radio', { name: /Let everyone pick their own/ }));
  await user.click(screen.getByRole('button', { name: 'Clear and switch' }));
  assert.equal(screen.getAllByText('Not yet claimed').length, 2);
  assert.equal(screen.getByTestId('roster-change-note').textContent, 'Switched. Items are now not yet claimed.');
});

test('the prompt answers Escape as Keep as is', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await handAssignFirstItem(user);
  await openPeople(user);
  await user.click(screen.getByRole('radio', { name: /Let everyone pick their own/ }));
  await user.keyboard('{Escape}');
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.ok(screen.getByText('Assigned: Me'));
});

// --- H7: the switch question must not outlive the moment it was asked -------

async function openSwitchQuestion(user) {
  await handAssignFirstItem(user);
  await openPeople(user);
  await user.click(screen.getByRole('radio', { name: /Let everyone pick their own/ }));
  assert.ok(screen.getByTestId('mode-switch-confirm'), 'the question is open');
}

test('H7: stepper 2 > 1 > 2 with the question open leaves it closed', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(screen.getByLabelText('Fewer people'));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  await user.click(screen.getByLabelText('More people'));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null, 'no question comes back with no tap');
});

test('H7: answering the question closes it for good, including after later changes', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(screen.getByRole('button', { name: 'Clear and switch' }));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  await user.click(screen.getByLabelText('Fewer people'));
  await user.click(screen.getByLabelText('More people'));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  await user.click(screen.getByRole('radio', { name: /I.ll assign the items/ }));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null, 'switching back asks nothing');
});

test('H7: changing the head-count while the question is open closes it, even if people stay at 2 or more', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(screen.getByLabelText('More people')); // 2 -> 3
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(storedPayers().length, 3);
  // Asking again still works normally.
  await user.click(screen.getByRole('radio', { name: /Let everyone pick their own/ }));
  assert.ok(screen.getByTestId('mode-switch-confirm'), 'a fresh tap asks afresh');
});

// --- H8: the question's own taps, look and notes (AC-M1 to AC-M12) ----------

const KEPT = "Kept as is. You're still assigning the items.";
const radioA = () => screen.getByRole('radio', { name: /I.ll assign the items/ });
const radioB = () => screen.getByRole('radio', { name: /Let everyone pick their own/ });
const statusNote = () => screen.getByTestId('roster-change-note').textContent;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20)); // focus moves after a tick

test('AC-M1: Clear and switch makes B the mode, clears, closes, focuses B and says so', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(screen.getByRole('button', { name: 'Clear and switch' }));
  await tick();
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(radioB().getAttribute('aria-checked'), 'true');
  assert.equal(screen.getAllByText('Not yet claimed').length, 2);
  assert.equal(document.activeElement, radioB());
  assert.equal(statusNote(), 'Switched. Items are now not yet claimed.');
});

test('AC-M2: Keep as is closes the question, keeps mode A, shows the Kept note and focuses A', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(screen.getByRole('button', { name: 'Keep as is' }));
  await tick();
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
  assert.ok(screen.getByText('Assigned: Me'));
  assert.equal(statusNote(), KEPT);
  assert.equal(document.activeElement, radioA());
});

test('AC-M3: Escape does the same as Keep as is, in full', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.keyboard('{Escape}');
  await tick();
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
  assert.ok(screen.getByText('Assigned: Me'));
  assert.equal(statusNote(), KEPT);
  assert.equal(document.activeElement, radioA());
});

test('AC-M4: tapping B again keeps one question, moves focus to its text and changes nothing else', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  screen.getByRole('button', { name: 'Clear and switch' }).focus(); // move focus away first
  await user.click(radioB());
  await tick();
  assert.equal(screen.getAllByTestId('mode-switch-confirm').length, 1);
  assert.equal(document.activeElement, document.getElementById('mode-switch-prompt'));
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
  assert.equal(radioB().getAttribute('aria-checked'), 'false');
  assert.ok(screen.getByText('Assigned: Me'));
  assert.equal(statusNote(), '', 'no note appears');
});

test('AC-M5: tapping A while the question is open closes it as Keep as is', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(radioA());
  await tick();
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(screen.queryByTestId('mode-switch-waiting-tag'), null);
  assert.equal(radioA().getAttribute('aria-checked'), 'true', 'A is still selected, never blank');
  assert.equal(within(screen.getByTestId('claim-mode-toggle')).getAllByRole('radio', { checked: true }).length, 1);
  assert.equal(statusNote(), KEPT);
  assert.equal(document.activeElement, radioA());
  assert.ok(screen.getByText('Assigned: Me'));
});

test('AC-M6: after tapping A, tapping B asks afresh with the tag and the Kept note is gone', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(radioA());
  assert.equal(statusNote(), KEPT);
  await user.click(radioB());
  assert.ok(screen.getByTestId('mode-switch-confirm'));
  assert.ok(screen.getByTestId('mode-switch-waiting-tag'));
  assert.equal(statusNote(), '');
  assert.equal(radioA().getAttribute('aria-checked'), 'true', 'mode is still A until answered');
});

test('AC-M7: closing and reopening the People panel leaves no question and no tag', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await done(user);
  await openPeople(user);
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(screen.queryByTestId('mode-switch-waiting-tag'), null);
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
  assert.ok(screen.getByText('Assigned: Me'));
});

test('AC-M8: people 2 > 1 > 2 with the question open brings the toggle back with no question and no tag', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(screen.getByLabelText('Fewer people'));
  assert.equal(screen.queryByTestId('claim-mode-toggle'), null);
  await user.click(screen.getByLabelText('More people'));
  assert.ok(screen.getByTestId('claim-mode-toggle'));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(screen.queryByTestId('mode-switch-waiting-tag'), null);
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
});

test('AC-M10: no way of closing the question changes the mode, the assignments or the server', async () => {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    calls += 1;
    return new Promise(() => {});
  };
  try {
    for (const route of ['keep', 'escape', 'tapA', 'panel']) {
      cleanup();
      const user = userEvent.setup();
      renderReview({ extraPeople: ['Ben'] });
      await openSwitchQuestion(user);
      if (route === 'keep') await user.click(screen.getByRole('button', { name: 'Keep as is' }));
      if (route === 'escape') await user.keyboard('{Escape}');
      if (route === 'tapA') await user.click(radioA());
      if (route === 'panel') {
        await done(user);
        await openPeople(user);
      }
      assert.equal(radioA().getAttribute('aria-checked'), 'true', route);
      assert.ok(screen.getByText('Assigned: Me'), `${route}: the hand-set item is untouched`);
      assert.equal(screen.queryByText('Not yet claimed'), null, route);
      assert.deepEqual(storedPayers(), ['Me', 'Ben'], route);
    }
    assert.equal(calls, 0, 'nothing is sent to the server');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('AC-M11: while pending, A stays lit and the only checked radio; B has a dark outline, the tag and aria-describedby; the box is white', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  assert.match(radioA().className, /\bborder-amber-600\b/);
  assert.match(radioA().className, /\bbg-amber-50\b/);
  assert.equal(within(screen.getByTestId('claim-mode-toggle')).getAllByRole('radio', { checked: true }).length, 1);
  assert.equal(radioB().getAttribute('aria-checked'), 'false');
  assert.match(radioB().className, /\bborder\b/);
  assert.match(radioB().className, /\bborder-slate-900\b/);
  assert.match(radioB().className, /\bring-1\b/);
  assert.doesNotMatch(radioB().className, /\bborder-2\b/, 'border-2 would move the box');
  assert.equal(radioB().getAttribute('aria-describedby'), 'mode-switch-prompt');
  assert.ok(document.getElementById('mode-switch-prompt'), 'the description target exists');
  const tag = screen.getByTestId('mode-switch-waiting-tag');
  assert.equal(tag.textContent, 'Waiting for your answer');
  assert.equal(tag.querySelector('.sr-only').textContent, ' for your answer');
  assert.equal(radioA().contains(tag), false, 'the tag belongs to B only');
  const box = screen.getByTestId('mode-switch-confirm');
  assert.match(box.className, /\bbg-white\b/);
  assert.doesNotMatch(box.className, /\bbg-amber-50\b/);
  assert.match(box.className, /\bborder-slate-900\b/);
  assert.match(box.className, /\bring-1\b/);
  // And it is all gone once answered.
  await user.click(screen.getByRole('button', { name: 'Keep as is' }));
  assert.equal(screen.queryByTestId('mode-switch-waiting-tag'), null);
  assert.equal(radioB().getAttribute('aria-describedby'), null);
  assert.doesNotMatch(radioB().className, /\bborder-slate-900\b/);
});

test('AC-M12: tapping an item row while the question is open does not close it', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openSwitchQuestion(user);
  await user.click(screen.getByRole('button', { name: /Roti Canai/ }));
  assert.ok(screen.getByTestId('mode-switch-confirm'), 'still open');
  assert.ok(screen.getByTestId('mode-switch-waiting-tag'), 'tag still shown');
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
});

test('AC-M5 edge: tapping A with no question open is still ignored', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await handAssignFirstItem(user);
  await openPeople(user);
  await user.click(radioA());
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
  assert.equal(statusNote(), '', 'no Kept note when nothing was asked');
  assert.ok(screen.getByText('Assigned: Me'));
});

test('single source: the scan-wait gate gets the same tag, tap-A close and Kept note', async () => {
  function GateHarness() {
    const { setParsed, addPayer, setItemAssignment } = useBillActions();
    const { parsed } = useBillState();
    useEffect(() => {
      addPayer('Ben');
      setParsed(BILL);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once
    }, []);
    useEffect(() => {
      if (parsed?.items?.length) setItemAssignment(parsed.items[0].id, 'Ben', false); // hand-assign
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once the bill is parsed
    }, [parsed]);
    return (
      <RosterGate
        scanDone={false}
        touched={false}
        onTouch={() => {}}
        onContinue={() => {}}
        showErrors={false}
        onShowErrors={() => {}}
      />
    );
  }
  const user = userEvent.setup();
  render(
    <BillProvider>
      <GateHarness />
    </BillProvider>
  );
  assert.equal(statusNote(), '', 'the status line is mounted and empty');
  await user.click(radioB());
  assert.ok(screen.getByTestId('mode-switch-confirm'));
  assert.ok(screen.getByTestId('mode-switch-waiting-tag'));
  await user.click(radioA());
  await tick();
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(screen.queryByTestId('mode-switch-waiting-tag'), null);
  assert.equal(radioA().getAttribute('aria-checked'), 'true');
  assert.equal(statusNote(), KEPT);
  assert.equal(document.activeElement, radioA());
});

test('AC-19: with nothing hand-assigned the switch is immediate, no prompt', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'] });
  await openPeople(user);
  await user.click(screen.getByRole('radio', { name: /Let everyone pick their own/ }));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(screen.getAllByText('Not yet claimed').length, 2);
});

test('AC-20: everyone-picks back to host fills the empty items with the default, no prompt', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'], claimMode: 'payers' });
  assert.equal(screen.getAllByText('Not yet claimed').length, 2);
  await openPeople(user);
  await user.click(screen.getByRole('radio', { name: /I'll assign the items/ }));
  assert.equal(screen.queryByTestId('mode-switch-confirm'), null);
  assert.equal(screen.getAllByText('Split 2 ways').length, 2);
});

test('AC-21: in everyone-picks, reducing to one person hides the toggle, returns to host mode and Confirm is not blocked', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'], claimMode: 'payers' });
  await openPeople(user);
  await user.click(screen.getByLabelText('Fewer people'));
  assert.equal(screen.queryByTestId('claim-mode-toggle'), null);
  assert.equal(screen.getAllByText('Split 1 ways').length, 2);
  assert.equal(confirm().disabled, false);
  await done(user);
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
});

// --- regressions ---------------------------------------------------------

test('NF-4: a solo bill continues with no extra tap and no roster blocker', async () => {
  const user = userEvent.setup();
  renderReview();
  assert.equal(screen.queryByTestId('roster-block-reason'), null);
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
});

test('E-7: going to payment and back keeps the roster and mode', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben'], claimMode: 'payers', withPayment: true });
  await user.click(confirm());
  assert.equal(currentScreen(), 'payment');
  assert.deepEqual(storedPayers(), ['Me', 'Ben']);
  // Back from the real payment screen returns to Review with the roster and mode intact.
  await user.click(screen.getByRole('button', { name: /Back/ }));
  assert.equal(currentScreen(), 'review');
  assert.deepEqual(storedPayers(), ['Me', 'Ben']);
  assert.equal(screen.getByTestId('people-summary').textContent, 'People: 2 (You, Ben)');
  assert.equal(screen.getAllByText('Not yet claimed').length, 2, 'still in let-everyone-pick mode');
});

test('no per-row Remove control: removal is by the stepper only (last person)', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben', 'Chloe'] });
  await openPeople(user);
  assert.equal(screen.queryByRole('button', { name: /^Remove/ }), null);
});

test('AC-8: Confirm with the editor closed and an invalid roster opens it, shows the message and focuses the first bad name', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Ben', 'Cy'], renames: [[2, 'ben']] });
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByText('Two people have the same name. Change one.'), null);
  await user.click(confirm());
  assert.notEqual(currentScreen(), 'payment');
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');
  assert.equal(screen.getAllByText('Two people have the same name. Change one.').length, 2);
  assert.equal(document.activeElement, screen.getByLabelText('Name for person 2'));
});

test('more people after renaming someone to a default-looking name still adds a new person', async () => {
  const user = userEvent.setup();
  renderReview({ extraPeople: ['Person 3'] });
  await openPeople(user);
  await user.click(screen.getByLabelText('More people'));
  assert.deepEqual(storedPayers(), ['Me', 'Person 3', 'Person 4']);
});
