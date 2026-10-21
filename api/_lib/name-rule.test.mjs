// The shared "same person?" rule, used on screen and on the server.
//
// Run: node --test api/_lib/name-rule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, sameName, cleanName, hasHiddenChars, stripHiddenChars } from './name-rule.js';

test('same name: letter case and spaces at the ends do not matter', () => {
  assert.equal(sameName('Ben', 'ben'), true);
  assert.equal(sameName(' Ben ', 'BEN'), true);
  assert.equal(sameName('Ben', 'Benny'), false);
});

test('same name: runs of spaces inside collapse to one', () => {
  assert.equal(sameName('Ben  Tan', 'Ben Tan'), true);
  assert.equal(sameName('Ben \t  Tan', 'ben tan'), true);
  assert.equal(sameName('BenTan', 'Ben Tan'), false);
});

test('same name: full-width letters and accents typed two ways match', () => {
  assert.equal(sameName('Ｂｅｎ', 'Ben'), true);
  assert.equal(sameName('Bén', 'Bén'), true);
  assert.equal(sameName('Ben', 'Bén'), false);
});

test('same name: hidden characters are ignored', () => {
  assert.equal(sameName('Ben​', 'Ben'), true);
  assert.equal(sameName('B‍e​n', 'ben'), true);
  assert.equal(sameName('﻿Ben', 'Ben'), true);
  assert.equal(sameName('Ben\u0007', 'Ben'), true);
  assert.equal(sameName('Ben ​ Tan', 'Ben Tan'), true);
});

test('same name: a letter from another alphabet is a different name (accepted residual risk)', () => {
  assert.equal(sameName('Ben', 'Bеn'), false); // Cyrillic small e
});

test('same name: non-text values never match', () => {
  assert.equal(nameKey(undefined), '');
  assert.equal(nameKey(null), '');
  assert.equal(nameKey(7), '');
});

test('cleanName: trims, collapses spaces, removes hidden characters, keeps case and letters', () => {
  assert.equal(cleanName('  Ben   Tan  '), 'Ben Tan');
  assert.equal(cleanName('Be​n'), 'Ben');
  assert.equal(cleanName('Ben ​ Tan'), 'Ben Tan');
  assert.equal(cleanName('Ｂen'), 'Ｂen'); // full-width kept as typed
  assert.equal(cleanName(undefined), '');
});

test('hidden characters are detected, ordinary spaces and tabs are not', () => {
  assert.equal(hasHiddenChars('Ben​'), true);
  assert.equal(hasHiddenChars('﻿Ben'), true);
  assert.equal(hasHiddenChars('Ben‮'), true);
  assert.equal(hasHiddenChars('Ben Tan'), false);
  assert.equal(hasHiddenChars('Ben Tan'), false);
  assert.equal(stripHiddenChars('Be​n  Tan'), 'Ben  Tan');
});
