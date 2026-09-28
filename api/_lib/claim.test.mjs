// api/_lib/claim.test.mjs — pure claim decisions (Item 24 Step 4).
// Run: node --test api/_lib/claim.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decideClaim, isItemUnclaimed } = require('./claim.js');
const { computeTotals } = require('./totals.js');

const roster = ['Ali', 'Bea', 'Cy'];
const items = [
  { id: 'i1', name: 'Nasi', category: 'food', qty: 1, unit_price: 10, line_total: 10 },
  { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 4, line_total: 4 },
  { id: 'i3', name: 'Ikan', category: 'food', qty: 1, unit_price: 20, line_total: 20 },
];
const wrap = (names, extra = {}) => ({ mode: 'equal', equal: names, manual: { unit: 'RM', values: {} }, ...extra });
const claimed = (names) => wrap(names, { claimed: true });
const manual = (values) => ({ mode: 'manual', equal: [], manual: { unit: 'RM', values } });
const decide = (assignments, action, names, itemId = 'i1') =>
  decideClaim({ payers: roster, assignments }, { action, itemId, names });

test('unclaimed shapes: absent, [], empty equal, names off the roster, manual with nothing positive', () => {
  assert.equal(isItemUnclaimed(undefined, roster), true);
  assert.equal(isItemUnclaimed([], roster), true);
  assert.equal(isItemUnclaimed(wrap([]), roster), true);
  assert.equal(isItemUnclaimed(wrap(['Zed']), roster), true);
  assert.equal(isItemUnclaimed(manual({}), roster), true);
  assert.equal(isItemUnclaimed(manual({ Ali: { cents: 0 }, Bea: { cents: -5 } }), roster), true);
  assert.equal(isItemUnclaimed(manual({ Zed: { cents: 500 } }), roster), true);
});

test('claimed shapes: array, equal with a roster name, manual with a positive amount', () => {
  assert.equal(isItemUnclaimed(['Ali'], roster), false);
  assert.equal(isItemUnclaimed(wrap(['Ali']), roster), false);
  assert.equal(isItemUnclaimed(manual({ Ali: { cents: 1 } }), roster), false);
});

test('isItemUnclaimed agrees with computeTotals().unclaimed for every shape', () => {
  const shapes = [
    undefined,
    [],
    ['Ali'],
    wrap([]),
    wrap(['Zed']),
    wrap(['Bea', 'Cy']),
    claimed(['Ali']),
    manual({}),
    manual({ Ali: { cents: 0 } }),
    manual({ Ali: { cents: 300 } }), // partly allocated: leftover is not unclaimed
    manual({ Zed: { cents: 300 } }),
    { mode: 'manual', amounts: { Ali: 300 } },
    { mode: 'manual', amounts: { Ali: 0 } },
  ];
  const totals = { subtotal: 10, service_charge: 1, tax: 0.6, grand_total: 11.6 };
  for (const shape of shapes) {
    const assignments = shape === undefined ? {} : { i1: shape };
    const { unclaimed } = computeTotals([items[0]], assignments, totals, roster);
    assert.equal(isItemUnclaimed(shape, roster), unclaimed.itemsCents === 1000, JSON.stringify(shape));
  }
});

test('claim on an unclaimed item writes the equal shape with the claimed flag; input is not mutated', () => {
  const before = { i2: ['Bea'] };
  const snapshot = JSON.stringify(before);
  const d = decide(before, 'claim', ['Ali']);
  assert.equal(d.outcome, 'applied');
  assert.deepEqual(d.assignments.i1, claimed(['Ali']));
  assert.deepEqual(d.assignments.i2, ['Bea']);
  assert.equal(JSON.stringify(before), snapshot);
});

test('shared claim stores every name, payer first', () => {
  const d = decide({}, 'claim', ['Bea', 'Ali', 'Cy']);
  assert.deepEqual(d.assignments.i1.equal, ['Bea', 'Ali', 'Cy']);
});

test('the shared claim is treated by computeTotals exactly like a host equal split', () => {
  const totals = { subtotal: 34, service_charge: 0, tax: 0, grand_total: 34 };
  const a = decide({}, 'claim', ['Ali', 'Bea']).assignments;
  const viaClaim = computeTotals(items, { ...a, i2: ['Cy'], i3: ['Cy'] }, totals, roster);
  const viaHost = computeTotals(items, { i1: ['Ali', 'Bea'], i2: ['Cy'], i3: ['Cy'] }, totals, roster);
  assert.deepEqual(viaClaim.perPerson, viaHost.perPerson);
});

test('repeat tap by someone already on a payer claim is unchanged', () => {
  assert.equal(decide({ i1: claimed(['Ali', 'Bea']) }, 'claim', ['Ali']).outcome, 'unchanged');
  assert.equal(decide({ i1: claimed(['Ali', 'Bea']) }, 'claim', ['Bea', 'Ali']).outcome, 'unchanged');
});

test('claim on an item already claimed by someone else is already_claimed', () => {
  assert.equal(decide({ i1: claimed(['Bea']) }, 'claim', ['Ali']).outcome, 'already_claimed');
  // caller is on it, but is trying to add people who are not: the item is taken
  assert.equal(decide({ i1: claimed(['Ali']) }, 'claim', ['Ali', 'Bea']).outcome, 'already_claimed');
});

test('host-assigned items are locked, even for a person the host named', () => {
  assert.equal(decide({ i1: ['Bea'] }, 'claim', ['Ali']).outcome, 'already_claimed');
  assert.equal(decide({ i1: ['Ali'] }, 'claim', ['Ali']).outcome, 'already_claimed');
  assert.equal(decide({ i1: wrap(['Ali', 'Bea']) }, 'claim', ['Ali']).outcome, 'already_claimed');
  assert.equal(decide({ i1: manual({ Bea: { cents: 500 } }) }, 'claim', ['Ali']).outcome, 'already_claimed');
});

test('the leftover on a partly allocated Set-amounts dish is not claimable', () => {
  const partly = manual({ Bea: { cents: 300 } }); // dish is RM 10.00, RM 7.00 left over
  assert.equal(decide({ i1: partly }, 'claim', ['Ali']).outcome, 'already_claimed');
});

test('a host item with no allocation at all is claimable', () => {
  assert.equal(decide({ i1: manual({}) }, 'claim', ['Ali']).outcome, 'applied');
  assert.equal(decide({ i1: [] }, 'claim', ['Ali']).outcome, 'applied');
});

test('unclaim removes only the caller; the item stays with the others', () => {
  const d = decide({ i1: claimed(['Ali', 'Bea', 'Cy']) }, 'unclaim', ['Bea']);
  assert.equal(d.outcome, 'applied');
  assert.deepEqual(d.assignments.i1.equal, ['Ali', 'Cy']);
  assert.equal(d.assignments.i1.claimed, true);
});

test('when the last name removes itself the item is unclaimed again (key removed)', () => {
  const d = decide({ i1: claimed(['Ali']), i2: ['Bea'] }, 'unclaim', ['Ali']);
  assert.equal(d.outcome, 'applied');
  assert.equal('i1' in d.assignments, false);
  assert.deepEqual(d.assignments.i2, ['Bea']);
});

test('unclaim of a name that is not the caller is not_your_claim', () => {
  assert.equal(decide({ i1: claimed(['Ali']) }, 'unclaim', ['Bea']).outcome, 'not_your_claim');
});

test('unclaim cannot touch a host-assigned or Set-amounts dish', () => {
  assert.equal(decide({ i1: ['Ali'] }, 'unclaim', ['Ali']).outcome, 'not_your_claim');
  assert.equal(decide({ i1: wrap(['Ali']) }, 'unclaim', ['Ali']).outcome, 'not_your_claim');
  assert.equal(decide({ i1: manual({ Ali: { cents: 500 } }) }, 'unclaim', ['Ali']).outcome, 'not_your_claim');
});

test('unclaim of an item nobody holds is unchanged (safe to retry)', () => {
  assert.equal(decide({}, 'unclaim', ['Ali']).outcome, 'unchanged');
});
