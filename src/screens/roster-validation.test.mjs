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
  assert.equal(r.messageFor(2), 'Two people have the same name. Change one.');
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

test('duplicate names: extra spaces inside, full-width letters and accents are caught (D2)', () => {
  assert.deepEqual(validateRoster(['Farah', 'Ben  Tan', 'Ben Tan']).duplicateIndices, [1, 2]);
  assert.deepEqual(validateRoster(['Farah', '\uFF22en', 'Ben']).duplicateIndices, [1, 2]);
  assert.deepEqual(validateRoster(['Farah', 'B\u00e9n', 'Be\u0301n']).duplicateIndices, [1, 2]);
});

test('duplicate names: a hidden character does not hide a clash (D2, ED-5)', () => {
  const r = validateRoster(['Farah', 'Ben', 'Ben\u200b']);
  assert.equal(r.valid, false);
  assert.deepEqual(r.duplicateIndices, [1, 2]);
  assert.equal(r.messageFor(2), 'Two people have the same name. Change one.');
});

test('duplicate names: only the clashing rows are marked (ED-2), all three when all match (ED-3)', () => {
  assert.deepEqual(validateRoster(['Farah', 'Ben', 'ben']).duplicateIndices, [1, 2]);
  assert.equal(validateRoster(['Farah', 'Ben', 'ben']).messageFor(0), null);
  assert.deepEqual(validateRoster(['Ben', 'ben', 'BEN']).duplicateIndices, [0, 1, 2]);
});

test('solo "Me" then another person called "me" is a clash (ED-6)', () => {
  assert.deepEqual(validateRoster(['Me', 'me']).duplicateIndices, [0, 1]);
});

test('the host name counts like any other row for a clash', () => {
  assert.deepEqual(validateRoster(['Ben', 'Ana', ' BEN ']).duplicateIndices, [0, 2]);
});

test('too-long and blank rows take the message before a clash (D12, ED-7)', () => {
  const r = validateRoster(['Farah', 'x'.repeat(21), 'X'.repeat(21)]);
  assert.deepEqual(r.tooLongIndices, [1, 2]);
  assert.deepEqual(r.clashOnlyIndices, []);
  assert.equal(r.messageFor(1), 'Keep names to 20 characters or fewer.');
  const blank = validateRoster(['Farah', ' ', '\u200b']);
  assert.deepEqual(blank.blankIndices, [1, 2]);
  assert.equal(blank.valid, false);
});

test('clashOnlyIndices lists the rows whose only problem is the shared name', () => {
  assert.deepEqual(validateRoster(['Farah', 'Ben', 'ben']).clashOnlyIndices, [1, 2]);
});

test('one person only: nothing is checked (D13)', () => {
  assert.equal(validateRoster(['Ben']).valid, true);
  assert.equal(validateRoster(['']).valid, true);
});

test('nextPersonLabel avoids case, space and look-alike clashes (D8)', () => {
  assert.equal(nextPersonLabel(['Me', 'person 3'], 3), 'Person 4');
  assert.equal(nextPersonLabel(['Me', 'PERSON  3'], 3), 'Person 4');
  assert.equal(nextPersonLabel(['Me', 'Person\u200b 3'], 3), 'Person 4');
  assert.equal(nextPersonLabel(['Me', '\uFF30erson 3'], 3), 'Person 4');
});
