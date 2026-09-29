// src/screens/claim-row-state.test.mjs — Item 24 Step 7.
// Run: node --test src/screens/claim-row-state.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRowState, namesList } from './claim-row-state.js';

const item = { line_total: 10 };
const roster = ['Farah', 'Ben', 'Chloe', 'Dee', 'Eng'];

test('no assignment at all: unclaimed', () => {
  const s = computeRowState(item, undefined, roster, 'Farah');
  assert.equal(s.kind, 'unclaimed');
});

test('empty equal array: unclaimed', () => {
  const s = computeRowState(item, { mode: 'equal', equal: [], manual: { unit: 'RM', values: {} } }, roster, 'Farah');
  assert.equal(s.kind, 'unclaimed');
});

test('a payer claim (claimed:true), just me: mine-alone', () => {
  const a = { mode: 'equal', equal: ['Farah'], manual: { unit: 'RM', values: {} }, claimed: true };
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'mine-alone');
  assert.equal(s.mineIncluded, true);
});

test('a payer claim, someone else: other-alone', () => {
  const a = { mode: 'equal', equal: ['Ben'], manual: { unit: 'RM', values: {} }, claimed: true };
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'other-alone');
  assert.equal(s.mineIncluded, false);
});

test('a shared claim including me: mine-shared, share is the largest-remainder equal split', () => {
  const a = { mode: 'equal', equal: ['Farah', 'Ben', 'Chloe'], manual: { unit: 'RM', values: {} }, claimed: true };
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'mine-shared');
  // 1000 cents / 3 = 333 + 333 + 334 (largest remainder to the first name)
  assert.equal(s.shareCents, 334);
});

test('a shared claim not including me: other-shared, names truncate past 3', () => {
  const a = {
    mode: 'equal',
    equal: ['Ben', 'Chloe', 'Dee', 'Eng'],
    manual: { unit: 'RM', values: {} },
    claimed: true,
  };
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'other-shared');
  assert.equal(namesList(s.names), 'Ben, Chloe +2');
});

test('host-set: an equal-split assignment with no claimed flag is locked, never claimable', () => {
  const a = { mode: 'equal', equal: ['Farah', 'Ben'], manual: { unit: 'RM', values: {} } }; // no claimed:true
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'host-set');
});

test('legacy plain-array assignment (no claimed flag possible at all): host-set', () => {
  const s = computeRowState(item, ['Farah'], roster, 'Farah');
  assert.equal(s.kind, 'host-set');
});

test('manual, fully allocated: host-set', () => {
  const a = { mode: 'manual', manual: { unit: 'RM', values: { Farah: { cents: 1000, text: '10.00' } } } };
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'host-set');
});

test('manual, partly allocated: host-partial, leftover not attributed to anyone', () => {
  const a = { mode: 'manual', manual: { unit: 'RM', values: { Farah: { cents: 400, text: '4.00' } } } };
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'host-partial');
  assert.deepEqual(s.names, ['Farah']);
});

test('manual, nothing actually allocated (zero cents everywhere): unclaimed', () => {
  const a = { mode: 'manual', manual: { unit: 'RM', values: { Farah: { cents: 0, text: '0.00' } } } };
  const s = computeRowState(item, a, roster, 'Farah');
  assert.equal(s.kind, 'unclaimed');
});

test('namesList: 3 or fewer never truncates', () => {
  assert.equal(namesList(['Ben']), 'Ben');
  assert.equal(namesList(['Ben', 'Chloe', 'Dee']), 'Ben, Chloe, Dee');
});

test('namesList: 4+ truncates to first two plus a count', () => {
  assert.equal(namesList(['Ben', 'Chloe', 'Dee', 'Eng']), 'Ben, Chloe +2');
});

test('me = null (no identity chosen yet): mineIncluded is always false', () => {
  const a = { mode: 'equal', equal: ['Farah'], manual: { unit: 'RM', values: {} }, claimed: true };
  const s = computeRowState(item, a, roster, null);
  assert.equal(s.mineIncluded, false);
  assert.equal(s.kind, 'other-alone');
});
