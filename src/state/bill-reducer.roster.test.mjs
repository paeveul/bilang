// Roster edits after the scan: adding and removing people, switching who
// picks the items, and keeping every assignment correct while it happens.
// Pure reducer tests (no DOM, no JSX).
//
// Run: node --test src/state/bill-reducer.roster.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reducer,
  initialState,
  defaultAssignment,
  assignmentKeys,
  hasHandAssignedItems,
  isDefaultAssignment,
  countUnallocatedItems,
} from './bill-reducer.js';
import { computeTotals } from '../../js/totals.js';

const ITEMS = [
  { id: 'i1', name: 'Nasi', category: 'food', qty: 1, unit_price: 10, line_total: 10 },
  { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 6, line_total: 6 },
  { id: 'i3', name: 'Roti', category: 'food', qty: 1, unit_price: 4, line_total: 4 },
];
const BILL = { items: ITEMS, subtotal: 20, service_charge: 2, tax: 1.2, grand_total: 23.2 };

function seeded(payers, extra = {}) {
  let s = { ...initialState, payers, parsed: BILL, ...extra };
  if ((extra.claimMode ?? 'host') === 'host') {
    ITEMS.forEach((item) => {
      if (!s.assignments[item.id]) {
        s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: item.id });
      }
    });
  }
  return s;
}

const apply = (s, ...actions) => actions.reduce((acc, a) => reducer(acc, a), s);

function tiesOut(state) {
  const { perPerson, unclaimed } = computeTotals(ITEMS, state.assignments, BILL, state.payers);
  const people = Object.values(perPerson).reduce((sum, p) => sum + p.totalCents, 0);
  return people + unclaimed.totalCents;
}
const BILL_CENTS = 2320;

// --- detection of hand-assigned items ---------------------------------

test('default detection: untouched items are default, a missing assignment counts as default', () => {
  const s = seeded(['Me', 'Ben']);
  assert.equal(hasHandAssignedItems(s), false);
  const bare = { ...s, assignments: {} };
  assert.equal(hasHandAssignedItems(bare), false);
});

test('default detection: unticking someone, a different split mode with amounts, or an empty item is hand-assigned', () => {
  const base = seeded(['Me', 'Ben']);
  const unticked = reducer(base, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Ben', checked: false });
  assert.equal(hasHandAssignedItems(unticked), true);

  let withAmounts = reducer(base, { type: 'SET_ITEM_MODE', itemId: 'i2', mode: 'manual' });
  withAmounts = reducer(withAmounts, {
    type: 'SET_ITEM_MANUAL_VALUE',
    itemId: 'i2',
    name: 'Me',
    text: '2',
    cents: 200,
  });
  assert.equal(hasHandAssignedItems(withAmounts), true);

  let emptied = reducer(base, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i3', name: 'Me', checked: false });
  emptied = reducer(emptied, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i3', name: 'Ben', checked: false });
  assert.equal(hasHandAssignedItems(emptied), true);
});

test('default detection: ticking a person off and back on returns the item to the default', () => {
  let s = seeded(['Me', 'Ben']);
  s = apply(
    s,
    { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Ben', checked: false },
    { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Ben', checked: true }
  );
  assert.equal(hasHandAssignedItems(s), false);
});

test('isDefaultAssignment: order of names does not matter; extra or missing names do', () => {
  assert.equal(isDefaultAssignment(defaultAssignment(['B', 'A']), ['A', 'B']), true);
  assert.equal(isDefaultAssignment(defaultAssignment(['A']), ['A', 'B']), false);
  assert.equal(isDefaultAssignment(['A', 'B'], ['A', 'B']), true);
});

// --- adding a person ----------------------------------------------------

test('AC-13: host assigns - a new person joins every untouched item and none the host changed', () => {
  let s = seeded(['Me', 'Ben']);
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i2', name: 'Ben', checked: false }); // hand-assigned
  const after = reducer(s, { type: 'ADD_PAYER', name: 'Chloe' });
  assert.deepEqual(after.payers, ['Me', 'Ben', 'Chloe']);
  assert.deepEqual(after.assignments.i1.equal, ['Me', 'Ben', 'Chloe']);
  assert.deepEqual(after.assignments.i3.equal, ['Me', 'Ben', 'Chloe']);
  assert.deepEqual(after.assignments.i2.equal, ['Me'], 'the hand-assigned item is left alone');
});

test('AC-13: the solo host who never touched the gate adds people on Review and everyone is on every item', () => {
  let s = seeded(['Me']);
  s = apply(
    s,
    { type: 'RENAME_PAYER', index: 0, name: '' },
    { type: 'ADD_PAYER', name: 'Person 2' },
    { type: 'RENAME_PAYER', index: 0, name: 'Alex' },
    { type: 'RENAME_PAYER', index: 1, name: 'Sam' }
  );
  assert.deepEqual(s.payers, ['Alex', 'Sam']);
  ITEMS.forEach((item) => assert.deepEqual(s.assignments[item.id].equal, ['Alex', 'Sam']));
  assert.equal(hasHandAssignedItems(s), false);
});

test('AC-13: an item with no assignment yet gets the default including the new person', () => {
  let s = seeded(['Me', 'Ben']);
  s = { ...s, assignments: { i1: s.assignments.i1 } };
  const after = reducer(s, { type: 'ADD_PAYER', name: 'Chloe' });
  assert.deepEqual(after.assignments.i2.equal, ['Me', 'Ben', 'Chloe']);
});

test('AC-14: everyone picks - adding a person changes no assignment', () => {
  let s = seeded(['Me', 'Ben'], { claimMode: 'payers' });
  s = { ...s, assignments: { i1: { ...defaultAssignment(['Ben']), equal: ['Ben'] } } };
  const after = reducer(s, { type: 'ADD_PAYER', name: 'Chloe' });
  assert.deepEqual(after.payers, ['Me', 'Ben', 'Chloe']);
  assert.equal(after.assignments, s.assignments);
});

test('add person: a blank name or a name already on the roster is refused', () => {
  const s = seeded(['Me', 'Ben']);
  assert.equal(reducer(s, { type: 'ADD_PAYER', name: '' }), s);
  assert.equal(reducer(s, { type: 'ADD_PAYER', name: 'Ben' }), s);
});

test('NF-5: totals tie out to the bill after adding and removing people', () => {
  let s = seeded(['Me', 'Ben']);
  assert.equal(tiesOut(s), BILL_CENTS);
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Ben', checked: false });
  s = reducer(s, { type: 'ADD_PAYER', name: 'Chloe' });
  assert.equal(tiesOut(s), BILL_CENTS);
  s = reducer(s, { type: 'REMOVE_PAYER', name: 'Chloe', index: 2 });
  assert.equal(tiesOut(s), BILL_CENTS);
  s = reducer(s, { type: 'SET_CLAIM_MODE', mode: 'payers' });
  assert.equal(tiesOut(s), BILL_CENTS, 'everything unclaimed still adds to the bill');
});

// --- removing a person --------------------------------------------------

test('AC-11: removing a person takes them off every item, equal lists and amounts', () => {
  let s = seeded(['Me', 'Ben']);
  s = apply(
    s,
    { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'manual' },
    { type: 'SET_ITEM_MANUAL_VALUE', itemId: 'i1', name: 'Ben', text: '3', cents: 300 }
  );
  const after = reducer(s, { type: 'REMOVE_PAYER', name: 'Ben', index: 1 });
  assert.deepEqual(after.payers, ['Me']);
  ITEMS.forEach((item) => assert.ok(!after.assignments[item.id].equal.includes('Ben')));
  assert.equal(after.assignments.i1.manual.values.Ben, undefined);
});

test('AC-12: removing the only person on an item leaves it with nobody (host mode)', () => {
  let s = seeded(['Me', 'Ben', 'Chloe']);
  s = apply(
    s,
    { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Me', checked: false },
    { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Chloe', checked: false }
  );
  const after = reducer(s, { type: 'REMOVE_PAYER', name: 'Ben', index: 1 });
  assert.deepEqual(after.assignments.i1.equal, []);
  assert.equal(after.claimMode, 'host');
  assert.equal(countUnallocatedItems(after), 1);
});

test('AC-15 / E-1: the last person cannot be removed', () => {
  const s = seeded(['Me']);
  assert.equal(reducer(s, { type: 'REMOVE_PAYER', name: 'Me', index: 0 }), s);
});

test('removing by index removes one person even when two share a name', () => {
  const s = { ...initialState, payers: ['Me', 'Ben', 'Ben'] };
  const after = reducer(s, { type: 'REMOVE_PAYER', name: 'Ben', index: 2 });
  assert.deepEqual(after.payers, ['Me', 'Ben']);
  const byNameOnly = reducer(s, { type: 'REMOVE_PAYER', name: 'Ben' });
  assert.deepEqual(byNameOnly.payers, ['Me', 'Ben'], 'by name alone it removes the last one, not both');
});

// --- switching who picks the items -------------------------------------

test('AC-17: host to everyone-picks with hand-assigned items clears every assignment', () => {
  let s = seeded(['Me', 'Ben']);
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Ben', checked: false });
  assert.equal(hasHandAssignedItems(s), true);
  const after = reducer(s, { type: 'SET_CLAIM_MODE', mode: 'payers' });
  assert.equal(after.claimMode, 'payers');
  assert.deepEqual(after.assignments, {});
  assert.deepEqual(after.payers, ['Me', 'Ben'], 'names and count are untouched');
});

test('AC-19: host to everyone-picks with nothing hand-assigned also clears the defaults', () => {
  const s = seeded(['Me', 'Ben']);
  assert.equal(hasHandAssignedItems(s), false);
  const after = reducer(s, { type: 'SET_CLAIM_MODE', mode: 'payers' });
  assert.deepEqual(after.assignments, {});
});

test('AC-20: everyone-picks to host fills only items with no allocation and keeps items that are set', () => {
  let s = seeded(['Me', 'Ben'], { claimMode: 'payers' });
  s = {
    ...s,
    assignments: {
      i1: { mode: 'equal', equal: ['Ben'], manual: { unit: 'RM', values: {} } },
      i3: { mode: 'equal', equal: [], manual: { unit: 'RM', values: {} } },
    },
  };
  const after = reducer(s, { type: 'SET_CLAIM_MODE', mode: 'host' });
  assert.equal(after.claimMode, 'host');
  assert.deepEqual(after.assignments.i1.equal, ['Ben'], 'set item stays as set');
  assert.deepEqual(after.assignments.i2.equal, ['Me', 'Ben'], 'missing assignment gets the default');
  assert.deepEqual(after.assignments.i3.equal, ['Me', 'Ben'], 'emptied assignment gets the default');
  assert.equal(countUnallocatedItems(after), 0);
});

test('AC-21: dropping to one person in everyone-picks returns to host mode and gives the one person the unallocated items', () => {
  let s = seeded(['Me', 'Ben'], { claimMode: 'payers' });
  s = { ...s, assignments: { i1: { mode: 'equal', equal: ['Me', 'Ben'], manual: { unit: 'RM', values: {} } } } };
  const after = reducer(s, { type: 'REMOVE_PAYER', name: 'Ben', index: 1 });
  assert.equal(after.claimMode, 'host');
  assert.deepEqual(after.payers, ['Me']);
  assert.deepEqual(after.assignments.i1.equal, ['Me']);
  assert.deepEqual(after.assignments.i2.equal, ['Me']);
  assert.deepEqual(after.assignments.i3.equal, ['Me']);
  assert.equal(countUnallocatedItems(after), 0, 'Confirm is not blocked by empty items');
});

test('AC-21 does not apply in host mode: removing down to one person keeps host mode and changes nothing else', () => {
  const s = seeded(['Me', 'Ben']);
  const after = reducer(s, { type: 'REMOVE_PAYER', name: 'Ben', index: 1 });
  assert.equal(after.claimMode, 'host');
});

test('switching to the mode already chosen is a no-op', () => {
  const s = seeded(['Me', 'Ben']);
  assert.equal(reducer(s, { type: 'SET_CLAIM_MODE', mode: 'host' }), s);
});

// --- renaming ----------------------------------------------------------

test('AC-7: renaming a person renames them on every item', () => {
  let s = seeded(['Me', 'Ben']);
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Me', checked: false });
  const after = reducer(s, { type: 'RENAME_PAYER', index: 1, name: 'Benny' });
  assert.deepEqual(after.assignments.i1.equal, ['Benny']);
  assert.deepEqual(after.assignments.i2.equal, ['Me', 'Benny']);
});

test('E-5: a rename that clashes with another person leaves ticks alone, and fixing it later restores the right person', () => {
  let s = seeded(['Me', 'Ben', 'Chloe']);
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Chloe', checked: false });
  // Ben types over their name until it matches Chloe (an invalid roster).
  s = reducer(s, { type: 'RENAME_PAYER', index: 1, name: 'Chloe' });
  assert.deepEqual(s.payers, ['Me', 'Chloe', 'Chloe']);
  assert.deepEqual(s.assignments.i1.equal, ['Me', 'Ben'], 'nothing merged or lost while the clash lasts');
  assert.deepEqual(assignmentKeys(s), ['Me', 'Ben', 'Chloe']);
  // Fixing the clash by giving Ben a new name.
  s = reducer(s, { type: 'RENAME_PAYER', index: 1, name: 'Benny' });
  assert.deepEqual(s.payers, ['Me', 'Benny', 'Chloe']);
  assert.deepEqual(s.assignments.i1.equal, ['Me', 'Benny']);
  assert.deepEqual(s.assignments.i2.equal, ['Me', 'Benny', 'Chloe']);
  assert.deepEqual(s.nameKeyByIndex, {});
});

test('E-5: names swapped through a clash end up with their own ticks', () => {
  let s = seeded(['Me', 'Ben', 'Chloe']);
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'Chloe', checked: false }); // Ben yes, Chloe no
  s = reducer(s, { type: 'RENAME_PAYER', index: 1, name: 'Chloe' }); // clash
  s = reducer(s, { type: 'RENAME_PAYER', index: 2, name: 'Ben' }); // swap complete
  assert.deepEqual(s.payers, ['Me', 'Chloe', 'Ben']);
  assert.deepEqual(s.assignments.i1.equal, ['Me', 'Chloe'], 'the person now called Chloe is the one who was on the item');
});

test('rename: a name that is only held as another person\'s stored name cannot be added as a new person', () => {
  let s = seeded(['Me', 'Ben', 'Chloe']);
  s = reducer(s, { type: 'RENAME_PAYER', index: 1, name: 'Chloe' }); // Ben is kept as a stored name
  assert.equal(reducer(s, { type: 'ADD_PAYER', name: 'Ben' }), s);
});

test('removing a person while a clash is open drops the right stored name', () => {
  let s = seeded(['Me', 'Ben', 'Chloe']);
  s = reducer(s, { type: 'RENAME_PAYER', index: 1, name: 'Chloe' }); // clash, Ben kept
  s = reducer(s, { type: 'REMOVE_PAYER', name: 'Chloe', index: 1 }); // remove the former Ben
  assert.deepEqual(s.payers, ['Me', 'Chloe']);
  ITEMS.forEach((item) => assert.deepEqual(s.assignments[item.id].equal.sort(), ['Chloe', 'Me']));
});

test('RESET clears the stored-name map along with the roster', () => {
  let s = seeded(['Me', 'Ben']);
  s = reducer(s, { type: 'RENAME_PAYER', index: 1, name: 'Me' });
  const reset = reducer(s, { type: 'RESET' });
  assert.deepEqual(reset.nameKeyByIndex, {});
  assert.deepEqual(reset.payers, ['Me']);
});
