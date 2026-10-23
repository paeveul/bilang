import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, MONEY_SENSITIVE_KEYS, t } from './receipt-check-strings.js';

test('every money-sensitive key exists', () => {
  for (const key of MONEY_SENSITIVE_KEYS) assert.ok(key in STRINGS, key);
});

test('placeholders: only {amount}, and the keys that talk about an amount carry it', () => {
  for (const [key, text] of Object.entries(STRINGS)) {
    const names = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const name of names) assert.equal(name, 'amount', key);
  }
  for (const key of ['tick.detail.higher', 'tick.detail.lower', 'tick.consequence', 'panel.ticked.adds', 'panel.ticked.takes_off', 'diff.adds', 'diff.takes_off']) {
    assert.match(STRINGS[key], /\{amount\}/, key);
  }
});

test('t() fills the amount and refuses an unknown key', () => {
  assert.equal(t('diff.adds', { amount: 'RM 0.03' }), 'Adds RM 0.03');
  assert.equal(t('diff.takes_off', { amount: 'RM 0.03' }), 'Takes off RM 0.03');
  assert.equal(t('tick.label'), 'This matches my paper receipt');
  assert.throws(() => t('no.such.key'));
});

test('direction words differ between adds and takes-off wording', () => {
  assert.match(t('panel.ticked.adds', { amount: 'RM 0.03' }), /adds RM 0\.03/);
  assert.match(t('panel.ticked.takes_off', { amount: 'RM 0.03' }), /takes off RM 0\.03/);
  assert.match(t('tick.detail.higher', { amount: 'RM 0.03' }), /higher/);
  assert.match(t('tick.detail.lower', { amount: 'RM 0.03' }), /lower/);
});

test('the word "rounded" appears in exactly one string, and the banned words appear in none', () => {
  const banned = /\b(reconcile|reconciliation|net|gross|variance|acknowledged|discrepancy|adjusted|corrected)\b/i;
  const withRounded = [];
  for (const [key, text] of Object.entries(STRINGS)) {
    assert.doesNotMatch(text, banned, key);
    assert.doesNotMatch(text, /\b(step|item \d+|AC-D\d+)\b/i, key);
    if (/rounded/i.test(text)) withRounded.push(key);
  }
  assert.deepEqual(withRounded, ['calc.cue.rounded']);
});

test('the reason line under Confirm is the fixed text', () => {
  assert.equal(
    STRINGS['confirm.reason.needs_tick'],
    'Tick that the screen matches your paper receipt, or fix the figure that is different'
  );
  assert.equal(STRINGS['calc.cue'], 'Calculated from qty x price');
});

test('there is no note string that promises anything about the printed figures beyond the tick consequence', () => {
  assert.equal('calc.note' in STRINGS, false);
});
