// src/state/bill-context-assignment.test.mjs — Item 22 Step 8: tests for
// BillContext.jsx's reducer logic around the combined correction +
// assignment screen's assignment shape (§5.1.1 — mode switching, the
// RM/% toggle, tick/untick behaviour, item correction actions).
//
// Pure reducer testing, same pattern as js/totals.test.mjs and
// router.jsx's resolveForTest — no DOM, no JSX transform needed, since this
// imports directly from ./bill-reducer.js, a plain .js file with no JSX in
// it (BillContext.jsx itself contains real JSX in <BillStateContext.
// Provider>, which a plain `node --test` run cannot parse at all — that's
// exactly why the reducer logic lives in its own JSX-free file; see that
// file's header comment).
//
// Run: node --test src/state/bill-context-assignment.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState, defaultAssignment } from './bill-reducer.js';

function stateWith(overrides) {
  return { ...initialState, ...overrides };
}

test('defaultAssignment — equal mode, everyone ticked, manual mode starts empty/blank/RM', () => {
  const a = defaultAssignment(['Alex', 'Bee']);
  assert.deepEqual(a, {
    mode: 'equal',
    equal: ['Alex', 'Bee'],
    manual: { unit: 'RM', values: {} },
  });
});

test('ENSURE_ITEM_DEFAULT_ASSIGNMENT — creates the default shape once, is a no-op if already present', () => {
  const s0 = stateWith({ payers: ['A', 'B'] });
  const s1 = reducer(s0, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  assert.deepEqual(s1.assignments.i1, defaultAssignment(['A', 'B']));

  // Mutate it, then ensure again — must not be overwritten.
  const s2 = { ...s1, assignments: { i1: { ...s1.assignments.i1, mode: 'manual' } } };
  const s3 = reducer(s2, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  assert.equal(s3.assignments.i1.mode, 'manual');
});

test('SET_ITEM_ASSIGNMENT — ticking/unticking updates the shared `equal` roster', () => {
  let s = stateWith({ payers: ['A', 'B', 'C'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'B', checked: false });
  assert.deepEqual(s.assignments.i1.equal, ['A', 'C']);

  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'B', checked: true });
  assert.ok(s.assignments.i1.equal.includes('B'));
  // Re-ticking an already-ticked name is a no-op, not a duplicate.
  const before = s.assignments.i1.equal;
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'B', checked: true });
  assert.deepEqual(s.assignments.i1.equal, before);
});

test('SET_ITEM_ASSIGNMENT — un-ticking a payer clears their manual value too (§5.1.1 point 7 edge case)', () => {
  let s = stateWith({ payers: ['A', 'B'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  s = reducer(s, { type: 'SET_ITEM_MANUAL_VALUE', itemId: 'i1', name: 'A', text: '5.00', cents: 500 });
  assert.equal(s.assignments.i1.manual.values.A.cents, 500);

  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'A', checked: false });
  assert.equal(s.assignments.i1.manual.values.A, undefined);
  assert.ok(!s.assignments.i1.equal.includes('A'));
});

test('SET_ITEM_MODE — switching to manual keeps the tick roster, starts values blank', () => {
  let s = stateWith({ payers: ['A', 'B', 'C'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  s = reducer(s, { type: 'SET_ITEM_ASSIGNMENT', itemId: 'i1', name: 'C', checked: false }); // A, B ticked

  s = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'manual' });
  assert.equal(s.assignments.i1.mode, 'manual');
  assert.deepEqual(s.assignments.i1.equal, ['A', 'B']); // tick roster carried across, unchanged
  assert.deepEqual(s.assignments.i1.manual.values, {}); // blank, not pre-filled with equal-split numbers
});

test('SET_ITEM_MODE — reverting from manual to equal discards typed values but keeps the tick roster', () => {
  let s = stateWith({ payers: ['A', 'B'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  s = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'manual' });
  s = reducer(s, { type: 'SET_ITEM_MANUAL_VALUE', itemId: 'i1', name: 'A', text: '3.00', cents: 300 });
  assert.equal(s.assignments.i1.manual.values.A.cents, 300);

  s = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'equal' });
  assert.equal(s.assignments.i1.mode, 'equal');
  assert.deepEqual(s.assignments.i1.manual.values, {}); // discarded
  assert.deepEqual(s.assignments.i1.equal, ['A', 'B']); // tick state untouched by the mode switch

  // Re-entering manual again starts blank again too (point 293's "fields
  // start blank" principle applies every time the mode is (re-)entered).
  s = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'manual' });
  assert.deepEqual(s.assignments.i1.manual.values, {});
});

test('SET_ITEM_MODE — switching to the mode that is already active is a no-op (same state reference)', () => {
  let s = stateWith({ payers: ['A'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  const s2 = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'equal' });
  assert.equal(s2, s); // reducer returned the exact same state object — a true no-op
});

test('SET_ITEM_MANUAL_UNIT — converts existing typed values live, cents (the canonical value) never changes', () => {
  let s = stateWith({ payers: ['A'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  s = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'manual' });
  s = reducer(s, { type: 'SET_ITEM_MANUAL_VALUE', itemId: 'i1', name: 'A', text: '2.11', cents: 211 });

  s = reducer(s, { type: 'SET_ITEM_MANUAL_UNIT', itemId: 'i1', unit: '%', lineTotal: 10.53 });
  assert.equal(s.assignments.i1.manual.unit, '%');
  assert.equal(s.assignments.i1.manual.values.A.cents, 211); // unchanged — canonical
  assert.equal(s.assignments.i1.manual.values.A.text, '20'); // 211/1053*100 = 20.04 -> "20" display

  s = reducer(s, { type: 'SET_ITEM_MANUAL_UNIT', itemId: 'i1', unit: 'RM', lineTotal: 10.53 });
  assert.equal(s.assignments.i1.manual.unit, 'RM');
  assert.equal(s.assignments.i1.manual.values.A.cents, 211); // still unchanged
  assert.equal(s.assignments.i1.manual.values.A.text, '2.11');
});

test('SET_ITEM_MANUAL_UNIT — switching to the already-active unit is a no-op', () => {
  let s = stateWith({ payers: ['A'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  const s2 = reducer(s, { type: 'SET_ITEM_MANUAL_UNIT', itemId: 'i1', unit: 'RM', lineTotal: 10 });
  assert.equal(s2, s);
});

test('REMOVE_PAYER — strips the removed payer from every item\'s equal roster and manual values', () => {
  let s = stateWith({ payers: ['A', 'B'] });
  s = reducer(s, { type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId: 'i1' });
  s = reducer(s, { type: 'SET_ITEM_MODE', itemId: 'i1', mode: 'manual' });
  s = reducer(s, { type: 'SET_ITEM_MANUAL_VALUE', itemId: 'i1', name: 'B', text: '5.00', cents: 500 });

  s = reducer(s, { type: 'REMOVE_PAYER', name: 'B' });
  assert.deepEqual(s.payers, ['A']);
  assert.deepEqual(s.assignments.i1.equal, ['A']);
  assert.equal(s.assignments.i1.manual.values.B, undefined);
});

test('REMOVE_PAYER — refuses to remove the last payer', () => {
  const s = stateWith({ payers: ['A'] });
  const s2 = reducer(s, { type: 'REMOVE_PAYER', name: 'A' });
  assert.equal(s2, s);
});

// --- Item correction actions ---

test('UPDATE_ITEM_FIELD, ADD_ITEM, REMOVE_ITEM — item correction round-trips correctly', () => {
  let s = stateWith({
    parsed: {
      items: [{ id: 'i1', name: 'Fried Rice', category: 'food', qty: 1, unit_price: 10, line_total: 10 }],
      subtotal: 10,
      service_charge: 0,
      tax: 0,
      grand_total: 10,
    },
  });

  s = reducer(s, { type: 'UPDATE_ITEM_FIELD', itemId: 'i1', field: 'name', value: 'Nasi Lemak' });
  assert.equal(s.parsed.items[0].name, 'Nasi Lemak');

  s = reducer(s, { type: 'ADD_ITEM' });
  assert.equal(s.parsed.items.length, 2);
  assert.equal(s.parsed.items[1].name, '');
  assert.equal(s.parsed.items[1].category, 'food');

  const newItemId = s.parsed.items[1].id;
  s = reducer(s, {
    type: 'SET_ITEM_ASSIGNMENT',
    itemId: newItemId,
    name: 'Me',
    checked: true,
  });
  assert.ok(s.assignments[newItemId]);

  s = reducer(s, { type: 'REMOVE_ITEM', itemId: 'i1' });
  assert.equal(s.parsed.items.length, 1);
  assert.equal(s.parsed.items[0].id, newItemId);
  // Removing an item also removes its assignment, so no orphaned
  // assignment data lingers (§5.1's own "no orphaned assignment data"
  // interaction/edge-case requirement).
  assert.equal(s.assignments.i1, undefined);
});

test('UPDATE_BILL_FIELD — edits the bill-level totals fields (§5.1 point 6)', () => {
  let s = stateWith({
    parsed: { items: [], subtotal: 10, service_charge: 0, tax: 0, grand_total: 10 },
  });
  s = reducer(s, { type: 'UPDATE_BILL_FIELD', field: 'service_charge', value: 1.5 });
  assert.equal(s.parsed.service_charge, 1.5);
});

test('item-correction actions are safe no-ops before parsed exists', () => {
  const s = stateWith({ parsed: null });
  assert.equal(reducer(s, { type: 'UPDATE_ITEM_FIELD', itemId: 'x', field: 'name', value: 'y' }), s);
  assert.equal(reducer(s, { type: 'ADD_ITEM' }), s);
  assert.equal(reducer(s, { type: 'REMOVE_ITEM', itemId: 'x' }), s);
  assert.equal(reducer(s, { type: 'UPDATE_BILL_FIELD', field: 'tax', value: 1 }), s);
});
