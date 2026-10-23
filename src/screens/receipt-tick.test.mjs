// The tick as data: when it is valid, what it changes in the status, the
// per-person preview (shown totals equal the saved ones) and the saved payload.
// Pure tests (no DOM, no JSX).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState, defaultAssignment } from '../state/bill-reducer.js';
import { moneySignature } from '../state/money-signature.js';
import { computeTotals } from '../../js/totals.js';
import {
  acknowledgedGapCents,
  billWithAcknowledgedGap,
  computeReceiptStatus,
} from './receipt-status.js';
import { buildSplitPayload } from './split-payload.js';

const item = (name, line_total, discount = 0) => ({
  name,
  category: 'food',
  qty: 1,
  unit_price: line_total,
  line_total,
  discount,
});
const BILL = (grand_total) => ({
  items: [item('Nasi', 50), item('Mee', 30), item('Teh', 20)],
  subtotal: 100,
  service_charge: 9,
  tax: 5.94,
  discount: 0,
  rounding: 0,
  grand_total,
});

function start(grand, payers = ['Me', 'Bea', 'Cik']) {
  let s = reducer({ ...initialState, payers }, { type: 'SET_PARSED', parsed: BILL(grand) });
  // Give each item one owner: first item Me, second Bea, third Cik.
  const owners = {};
  s.parsed.items.forEach((it, i) => {
    owners[it.id] = [payers[i % payers.length]];
  });
  return { ...s, assignments: owners };
}
const tickIt = (s) =>
  reducer(s, { type: 'SET_GAP_ACK', signature: moneySignature(s.parsed), gapCents: computeReceiptStatus(s.parsed.items, s.parsed).differenceCents });

test('the tick is valid only at the fingerprint and difference it was made at', () => {
  let s = tickIt(start(114.97));
  assert.equal(acknowledgedGapCents(s.parsed.items, s.parsed, s.gapAck), 3);
  // A different difference than the one ticked.
  assert.equal(acknowledgedGapCents(s.parsed.items, s.parsed, { ...s.gapAck, gapCents: 4 }), 0);
  // Nothing ticked.
  assert.equal(acknowledgedGapCents(s.parsed.items, s.parsed, null), 0);
});

test('status: ticked lifts the block for a difference, never for an impossible figure', () => {
  const s = tickIt(start(114.97));
  const off = computeReceiptStatus(s.parsed.items, s.parsed);
  assert.equal(off.kind, 'off');
  assert.equal(off.blocked, true);
  assert.equal(off.hardError, false);
  const ticked = computeReceiptStatus(s.parsed.items, s.parsed, { ticked: true });
  assert.equal(ticked.kind, 'ticked');
  assert.equal(ticked.blocked, false);
  assert.equal(ticked.differenceCents, 3);
  const bad = { ...s.parsed, discount: 500 };
  const hard = computeReceiptStatus(bad.items, bad, { ticked: true });
  assert.equal(hard.kind, 'bill_discount_too_big');
  assert.equal(hard.blocked, true);
  assert.equal(hard.hardError, true);
});

test('every kind of edit clears the tick: each money field, item content, add and remove', () => {
  const edits = (s) => {
    const id = s.parsed.items[0].id;
    return [
      { type: 'UPDATE_ITEM_FIELD', itemId: id, field: 'name', value: 'Nasi X' },
      { type: 'UPDATE_ITEM_FIELD', itemId: id, field: 'qty', value: 2 },
      { type: 'UPDATE_ITEM_FIELD', itemId: id, field: 'unit_price', value: 51 },
      { type: 'UPDATE_ITEM_FIELD', itemId: id, field: 'line_total', value: 49 },
      { type: 'UPDATE_ITEM_FIELD', itemId: id, field: 'discount', value: 1 },
      { type: 'UPDATE_BILL_FIELD', field: 'subtotal', value: 99 },
      { type: 'UPDATE_BILL_FIELD', field: 'service_charge', value: 9.5 },
      { type: 'UPDATE_BILL_FIELD', field: 'tax', value: 6 },
      { type: 'UPDATE_BILL_FIELD', field: 'discount', value: 1 },
      { type: 'UPDATE_BILL_FIELD', field: 'rounding', value: 0.01 },
      { type: 'UPDATE_BILL_FIELD', field: 'grand_total', value: 115 },
      { type: 'ADD_ITEM' },
      { type: 'REMOVE_ITEM', itemId: id },
    ];
  };
  const base = tickIt(start(114.97));
  assert.ok(base.gapAck);
  for (const action of edits(base)) {
    const after = reducer(base, action);
    assert.equal(after.gapAck, null, `${action.type} ${action.field || ''}`);
    assert.equal(after.gapAckCleared, true);
  }
});

test('assignment and roster changes and a category change leave the tick alone', () => {
  const base = tickIt(start(114.97));
  const id = base.parsed.items[0].id;
  const actions = [
    { type: 'SET_ITEM_ASSIGNMENT', itemId: id, name: 'Bea', checked: true },
    { type: 'SET_ITEM_ASSIGNMENT', itemId: id, name: 'Bea', checked: false },
    { type: 'SET_ITEM_MODE', itemId: id, mode: 'manual' },
    { type: 'ADD_PAYER', name: 'Dan' },
    { type: 'UPDATE_ITEM_FIELD', itemId: id, field: 'category', value: 'drink' },
  ];
  let s = base;
  for (const action of actions) {
    s = reducer(s, action);
    assert.ok(s.gapAck, action.type);
    assert.equal(s.gapAckCleared, false);
  }
  assert.equal(acknowledgedGapCents(s.parsed.items, s.parsed, s.gapAck), 3);
});

test('a manual untick clears without the "cleared by an edit" note; a refused save clears the tick and keeps the figures', () => {
  const base = tickIt(start(114.97));
  const off = reducer(base, { type: 'CLEAR_GAP_ACK' });
  assert.equal(off.gapAck, null);
  assert.equal(off.gapAckCleared, false);
  const refused = reducer(base, { type: 'SET_SAVE_ERROR', code: 'receipt_does_not_add_up' });
  assert.equal(refused.gapAck, null);
  assert.equal(refused.saveError, 'receipt_does_not_add_up');
  assert.equal(refused.parsed.grand_total, 114.97);
  // The next money edit removes the message; ticking again also does.
  assert.equal(reducer(refused, { type: 'UPDATE_BILL_FIELD', field: 'tax', value: 6 }).saveError, null);
  assert.equal(tickIt(refused).saveError, null);
});

test('preview before the tick leaves the gap out, after the tick puts it in, and matches the saved totals', () => {
  for (const grand of [114.97, 114.91, 116.94]) {
    const before = start(grand);
    const payers = before.payers;
    const gap = computeReceiptStatus(before.parsed.items, before.parsed).differenceCents;
    const sumOf = (r) =>
      Object.values(r.perPerson).reduce((a, p) => a + p.totalCents, 0) + r.unclaimed.totalCents;

    // Not ticked: what the screen shows is items, service and tax only.
    const shown = computeTotals(before.parsed.items, before.assignments, billWithAcknowledgedGap(before.parsed.items, before.parsed, before.gapAck), payers);
    assert.equal(sumOf(shown), Math.round(grand * 100) - gap);

    // Ticked: the preview includes the gap and equals the saved payload's totals.
    const after = tickIt(before);
    const preview = computeTotals(after.parsed.items, after.assignments, billWithAcknowledgedGap(after.parsed.items, after.parsed, after.gapAck), payers);
    assert.equal(sumOf(preview), Math.round(grand * 100));
    const payload = buildSplitPayload({
      parsed: after.parsed,
      payers,
      assignments: after.assignments,
      ownerPaymentHandle: 'x',
      gapAck: after.gapAck,
    });
    for (const name of payers) {
      assert.equal(Math.round(payload.totals.per_person[name] * 100), preview.perPerson[name].totalCents, name);
    }
    assert.equal(payload.totals.receipt_gap_cents, gap);
    assert.equal(payload.totals.receipt_gap_acknowledged, true);
    // Printed figures go out exactly as scanned.
    assert.equal(payload.totals.grand_total, grand);
    assert.equal(payload.totals.rounding, 0);
    assert.equal(payload.totals.discount, 0);
    assert.equal(payload.totals.service_charge, 9);
    assert.equal(payload.totals.tax, 5.94);
  }
});

test('payload: no markers without a valid tick, on a receipt that adds up, or with a stale tick', () => {
  const clean = start(114.94);
  const noTick = buildSplitPayload({ parsed: clean.parsed, payers: clean.payers, assignments: clean.assignments, ownerPaymentHandle: 'x', gapAck: null });
  assert.equal('receipt_gap_cents' in noTick.totals, false);
  const gapNoTick = start(114.97);
  const p2 = buildSplitPayload({ parsed: gapNoTick.parsed, payers: gapNoTick.payers, assignments: gapNoTick.assignments, ownerPaymentHandle: 'x', gapAck: null });
  assert.equal('receipt_gap_cents' in p2.totals, false);
  const ticked = tickIt(gapNoTick);
  const changed = reducer(ticked, { type: 'UPDATE_BILL_FIELD', field: 'tax', value: 6 });
  const staleAck = ticked.gapAck;
  const p3 = buildSplitPayload({ parsed: changed.parsed, payers: changed.payers, assignments: changed.assignments, ownerPaymentHandle: 'x', gapAck: staleAck });
  assert.equal('receipt_gap_cents' in p3.totals, false);
  assert.equal('receipt_gap_acknowledged' in p3.totals, false);
});

test('a scan opened and confirmed with no edit is sent exactly as scanned, to the sen', () => {
  const s = start(114.94);
  const scanned = BILL(114.94);
  const payload = buildSplitPayload({ parsed: s.parsed, payers: s.payers, assignments: s.assignments, ownerPaymentHandle: 'x', gapAck: s.gapAck });
  for (const f of ['subtotal', 'service_charge', 'tax', 'grand_total', 'discount', 'rounding']) {
    assert.equal(payload.totals[f], scanned[f], f);
  }
  payload.items.forEach((it, i) => {
    for (const f of ['qty', 'unit_price', 'line_total', 'discount', 'name']) assert.equal(it[f], scanned.items[i][f], f);
  });
  assert.equal(s.gapAck, null);
});

test('default assignment shape is unaffected (guards the helper used above)', () => {
  assert.equal(defaultAssignment(['A']).mode, 'equal');
});
