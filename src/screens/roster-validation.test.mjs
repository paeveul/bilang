import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoster, MAX_NAME_LEN, summarizeRoster, nextPersonLabel } from './roster-validation.js';

test('solo (people = 1): always valid, nothing checked', () => {
  const r = validateRoster(['Me']);
  assert.equal(r.valid, true);
  assert.equal(r.hostNameBlank, false);
  assert.deepEqual(r.blankIndices, []);
});

test('multi-person, host name blank: G7', () => {
  const r = validateRoster(['', 'Person 2']);
  assert.equal(r.valid, false);
  assert.equal(r.hostNameBlank, true);
  assert.equal(r.messageFor(0), 'Add your name so friends know which one is you.');
});

test('multi-person, a later row blank: G8', () => {
  const r = validateRoster(['Farah', '']);
  assert.equal(r.valid, false);
  assert.deepEqual(r.blankIndices, [1]);
  assert.equal(r.messageFor(1), 'Add a name for person 2.');
});

test('duplicate names, case-insensitive/trimmed: G9', () => {
  const r = validateRoster(['Farah', 'Ben', ' ben ']);
  assert.equal(r.valid, false);
  assert.deepEqual(r.duplicateIndices, [1, 2]);
  assert.equal(r.messageFor(2), "Two people are called 'ben'. Give each a different name.");
});

test('name too long: G10', () => {
  const r = validateRoster(['Farah', 'x'.repeat(MAX_NAME_LEN + 1)]);
  assert.equal(r.valid, false);
  assert.deepEqual(r.tooLongIndices, [1]);
  assert.equal(r.messageFor(1), 'Keep names to 20 characters or fewer.');
});

test('name exactly at the 20-character ceiling is valid', () => {
  const r = validateRoster(['Farah', 'x'.repeat(MAX_NAME_LEN)]);
  assert.equal(r.valid, true);
});

test('valid multi-person roster', () => {
  const r = validateRoster(['Farah', 'Ben', 'Chloe']);
  assert.equal(r.valid, true);
  assert.equal(r.messageFor(0), null);
});

test('messageFor returns null for a row with no problem', () => {
  const r = validateRoster(['Farah', 'Ben']);
  assert.equal(r.messageFor(1), null);
});

test('AC-2/AC-3: the summary shows the host as You, even for one person', () => {
  assert.equal(summarizeRoster(['Me']).text, 'People: 1 (You)');
  assert.equal(summarizeRoster(['Alex', 'Ben']).text, 'People: 2 (You, Ben)');
});

test('AC-4: after three names the rest collapse to +N', () => {
  assert.equal(summarizeRoster(['Me', 'Ben', 'Chloe']).text, 'People: 3 (You, Ben, Chloe)');
  assert.equal(summarizeRoster(['Me', 'Ben', 'Chloe', 'D', 'E', 'F']).text, 'People: 6 (You, Ben, Chloe +3)');
});

test('summary: a blank other name reads (no name); names are trimmed', () => {
  assert.equal(summarizeRoster(['Me', '', ' Ben ']).text, 'People: 3 (You, (no name), Ben)');
});

test('nextPersonLabel skips default-looking names already in use', () => {
  assert.equal(nextPersonLabel(['Me', 'Person 2'], 3), 'Person 3');
  assert.equal(nextPersonLabel(['Me', 'Person 3'], 3), 'Person 4');
});
