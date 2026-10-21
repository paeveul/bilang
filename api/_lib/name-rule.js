// api/_lib/name-rule.js
//
// The one rule for "are these two names the same person?". CommonJS so the
// serverless handlers can require() it; the browser screens import it from
// here too (same pattern as totals.js), so the roster check on screen and the
// check on the server cannot drift apart.
//
// Two names are the same when they are equal after: turning every kind of
// space into a plain space, Unicode NFKC (full-width letters, accents typed
// two ways), removing hidden characters (zero-width, control, format),
// collapsing runs of spaces, trimming the ends, and lower-casing.
//
// Letters from different alphabets that merely look alike (a Cyrillic "а"
// for a Latin "a") are NOT treated as the same: accepted residual risk.

// Every kind of space becomes a plain space, except the byte-order mark (U+FEFF),
// which JavaScript counts as a space but is really a hidden character.
const spacesToPlain = (text) => text.replace(/\s/g, (ch) => (ch === '﻿' ? ch : ' '));

const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/gu;
const HAS_HIDDEN_CHAR = /[\p{Cc}\p{Cf}]/u;

/** True when the text holds a hidden character: zero-width, control or format. */
function hasHiddenChars(name) {
  return typeof name === 'string' && HAS_HIDDEN_CHAR.test(spacesToPlain(name));
}

/** The text with hidden characters removed; everything else left as typed. */
function stripHiddenChars(name) {
  if (typeof name !== 'string') return '';
  return spacesToPlain(name).replace(HIDDEN_CHARS, '');
}

/**
 * What gets saved and sent: hidden characters removed, ends trimmed, runs of
 * spaces collapsed to one. Letters and their case are left as typed.
 */
function cleanName(name) {
  return stripHiddenChars(name).replace(/ +/g, ' ').trim();
}

/** The comparison key: two names are the same person when their keys are equal. */
function nameKey(name) {
  if (typeof name !== 'string') return '';
  return cleanName(name.normalize('NFKC')).toLowerCase();
}

function sameName(a, b) {
  return nameKey(a) === nameKey(b);
}

module.exports = {
  hasHiddenChars,
  stripHiddenChars,
  cleanName,
  nameKey,
  sameName,
};
