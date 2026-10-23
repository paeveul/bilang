// A host edit of quantity or unit price works out the line price; nothing
// else on the bill moves except the subtotal, by the same amount. Pure
// reducer tests (no DOM, no JSX).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './bill-reducer.js';
import { buildSplitPayload } from '../screens/split-payload.js';
import { lineTotalFromQty, toCents } from '../../js/totals.js';

const ITEMS = [
  { id: 'i1', name: 'Nasi', category: 'food', qty: 2, unit_price: 6.5, line_total: 13, discount: 1 },
  { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 4, line_total: 4, discount: 0 },
];
const BILL = {
  items: ITEMS,
  subtotal: 17,
  service_charge: 1.7,
  tax: 1.02,
  discount: 0.5,
  rounding: 0.01,
  scanned_rounding: 0.01,
  grand_total: 18.23,
};

const seeded = () => ({ ...initialState, payers: ['Me'], parsed: BILL });
const edit = (state, itemId, field, value) => reducer(state, { type: 'UPDATE_ITEM_FIELD', itemId, field, value });
const itemOf = (state, id) => state.parsed.items.find((i) => i.id === id);

// Everything on the bill except the edited row and the subtotal.
function untouched(before, after, edited = null, itemId = 'i1') {
  for (const f of ['service_charge', 'tax', 'discount', 'rounding', 'scanned_rounding', 'grand_total']) {
    assert.equal(after.parsed[f], before.parsed[f], f);
  }
  for (const item of before.parsed.items) {
    if (item.id === itemId) continue;
    assert.deepEqual(itemOf(after, item.id), item, item.id);
  }
  for (const f of ['name', 'category', 'discount']) {
    if (f !== edited) assert.equal(itemOf(after, itemId)[f], itemOf(before, itemId)[f], f);
  }
}

test('qty edit: the line price follows, the subtotal moves by the same amount, nothing else moves', () => {
  const before = seeded();
  const after = edit(before, 'i1', 'qty', 3);
  assert.equal(itemOf(after, 'i1').qty, 3);
  assert.equal(itemOf(after, 'i1').unit_price, 6.5);
  assert.equal(itemOf(after, 'i1').line_total, 19.5);
  assert.equal(after.parsed.subtotal, 23.5);
  assert.equal(after.derived.lines.i1, 'calc');
  assert.equal(after.derived.subtotalMoved, true);
  untouched(before, after);
});

test('unit price edit: same, qty stays as it was', () => {
  const before = seeded();
  const after = edit(before, 'i1', 'unit_price', 7);
  assert.equal(itemOf(after, 'i1').qty, 2);
  assert.equal(itemOf(after, 'i1').line_total, 14);
  assert.equal(after.parsed.subtotal, 18);
  untouched(before, after);
});

test('line price edit: only that field and the subtotal move; qty and unit price stay; cue says kept', () => {
  const before = seeded();
  const after = edit(before, 'i1', 'line_total', 12.34);
  assert.equal(itemOf(after, 'i1').qty, 2);
  assert.equal(itemOf(after, 'i1').unit_price, 6.5);
  assert.equal(itemOf(after, 'i1').line_total, 12.34);
  assert.equal(after.parsed.subtotal, 16.34);
  assert.equal(after.derived.lines.i1, 'kept');
  untouched(before, after);
});

test('overwrite after a qty edit is kept; editing qty again works the price out again', () => {
  let s = edit(seeded(), 'i1', 'qty', 3);
  s = edit(s, 'i1', 'line_total', 20);
  assert.equal(itemOf(s, 'i1').line_total, 20);
  assert.equal(itemOf(s, 'i1').qty, 3);
  assert.equal(s.derived.lines.i1, 'kept');
  assert.equal(s.parsed.subtotal, 24);
  s = edit(s, 'i1', 'qty', 4);
  assert.equal(itemOf(s, 'i1').line_total, 26);
  assert.equal(s.derived.lines.i1, 'calc');
  assert.equal(s.parsed.subtotal, 30);
});

test('typing digit by digit moves the subtotal only by the net change, to the sen', () => {
  let s = seeded();
  for (const v of [1, 12, 12.3, 12.34]) s = edit(s, 'i1', 'line_total', v);
  assert.equal(s.parsed.subtotal, 16.34);
  assert.equal(toCents(s.parsed.subtotal), 1634);
});

test('decimal quantity: half up on the exact product, once, on the final line price only', () => {
  const cases = [
    // qty, unit price, expected sen, cue
    [0.333, 12.9, 430, 'rounded'], // 429.57
    [2, 6.5, 1300, 'calc'],
    [0.25, 10.1, 253, 'rounded'], // 252.5, a true half
    [0.5, 3.33, 167, 'rounded'], // 166.5
    [1.25, 2.1, 263, 'rounded'], // 262.5
    [1.005, 1, 101, 'rounded'], // 100.5: naive floating point gives 100
    [100, 1.005, 10050, 'calc'], // exactly a whole sen
    [0.001, 49.99, 5, 'rounded'], // 4.999
    [1.0049, 1, 100, 'rounded'], // 100.49 stays down
  ];
  for (const [qty, unit, sen, kind] of cases) {
    let s = edit(seeded(), 'i2', 'unit_price', unit);
    s = edit(s, 'i2', 'qty', qty);
    assert.equal(toCents(itemOf(s, 'i2').line_total), sen, `${qty} x ${unit}`);
    assert.equal(s.derived.lines.i2, kind, `${qty} x ${unit}`);
    assert.equal(itemOf(s, 'i2').qty, qty, 'qty is never rounded');
    assert.equal(itemOf(s, 'i2').unit_price, unit, 'unit price is never rounded');
  }
});

test('the cue goes back to calculated as soon as the product is a whole sen again', () => {
  let s = edit(edit(seeded(), 'i1', 'unit_price', 12.9), 'i1', 'qty', 0.333);
  assert.equal(s.derived.lines.i1, 'rounded');
  s = edit(edit(s, 'i1', 'qty', 2), 'i1', 'unit_price', 6.5);
  assert.equal(s.derived.lines.i1, 'calc');
  assert.equal(itemOf(s, 'i1').line_total, 13);
});

test('lineTotalFromQty: exact where floating point would flip a true half, and null when there is nothing to work out', () => {
  assert.equal(Math.round(1.005 * 1 * 100), 100); // the trap
  assert.deepEqual(lineTotalFromQty(1.005, 1), { cents: 101, rounded: true });
  assert.deepEqual(lineTotalFromQty(2, 6.5), { cents: 1300, rounded: false });
  assert.equal(lineTotalFromQty(0, 5), null);
  assert.equal(lineTotalFromQty(-1, 5), null);
  assert.equal(lineTotalFromQty(NaN, 5), null);
  assert.equal(lineTotalFromQty(1, -5), null);
  assert.equal(lineTotalFromQty(1e21, 5), null);
  assert.deepEqual(lineTotalFromQty(1, 0), { cents: 0, rounded: false });
});

test('qty empty, invalid or not above zero: no recalculation, nothing else changes', () => {
  const before = seeded();
  for (const bad of [0, -1, NaN]) {
    const after = edit(before, 'i1', 'qty', bad);
    assert.equal(itemOf(after, 'i1').line_total, 13);
    assert.equal(after.parsed.subtotal, 17);
    assert.deepEqual(after.derived, before.derived);
  }
});

test('other fields (name, category, discount) move nothing but themselves', () => {
  const before = seeded();
  for (const [field, value] of [['name', 'Nasi Goreng'], ['category', 'other'], ['discount', 2]]) {
    const after = edit(before, 'i1', field, value);
    assert.equal(itemOf(after, 'i1')[field], value);
    assert.equal(itemOf(after, 'i1').line_total, 13);
    assert.equal(after.parsed.subtotal, 17);
    assert.deepEqual(after.derived, before.derived);
    untouched(before, after, field);
  }
});

test('no edit: a scan opened and left alone is bit-identical, with no derived marker', () => {
  const s = reducer(initialState, { type: 'SET_PARSED', parsed: { ...BILL, items: ITEMS.map(({ id, ...rest }) => rest) } });
  assert.deepEqual(s.derived, { lines: {}, subtotalMoved: false });
  for (const f of ['subtotal', 'service_charge', 'tax', 'discount', 'rounding', 'grand_total']) {
    assert.equal(s.parsed[f], BILL[f], f);
  }
  s.parsed.items.forEach((item, i) => {
    for (const f of ['qty', 'unit_price', 'line_total', 'discount']) assert.equal(item[f], ITEMS[i][f], f);
  });
});

test('the derived markers never reach the saved payload', () => {
  let s = edit(seeded(), 'i1', 'qty', 3);
  s = { ...s, assignments: { i1: ['Me'], i2: ['Me'] } };
  const payload = buildSplitPayload({
    parsed: s.parsed,
    payers: s.payers,
    assignments: s.assignments,
    ownerPaymentHandle: 'x',
  });
  assert.equal(JSON.stringify(payload).includes('derived'), false);
  assert.equal(JSON.stringify(payload).includes('subtotalMoved'), false);
  for (const item of payload.items) assert.deepEqual(Object.keys(item).sort(), Object.keys(ITEMS[0]).sort());
});

test('removing an item drops its marker; typing a subtotal clears the moved note', () => {
  let s = edit(seeded(), 'i1', 'qty', 3);
  s = reducer(s, { type: 'REMOVE_ITEM', itemId: 'i1' });
  assert.equal('i1' in s.derived.lines, false);
  s = edit(seeded(), 'i1', 'qty', 3);
  s = reducer(s, { type: 'UPDATE_BILL_FIELD', field: 'subtotal', value: 99 });
  assert.equal(s.derived.subtotalMoved, false);
  assert.equal(s.parsed.subtotal, 99);
});

test('a state built without the marker (older callers) still edits safely', () => {
  const { derived, ...legacy } = seeded();
  const after = edit(legacy, 'i1', 'qty', 3);
  assert.equal(itemOf(after, 'i1').line_total, 19.5);
  assert.equal(after.derived.lines.i1, 'calc');
});
