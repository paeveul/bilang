import { cleanName, nameKey, stripHiddenChars } from '../../api/_lib/name-rule.js';

export const MAX_NAME_LEN = 20;

// Same rule the server uses, so a name that passes here passes there.
export { cleanName, nameKey, stripHiddenChars };

const isBlank = (name) => typeof name !== 'string' || cleanName(name).length === 0;

/**
 * @param {string[]} payers - roster names in gate-row order; index 0 is the
 *   host's own row.
 * @returns {{
 *   hostNameBlank: boolean,
 *   blankIndices: number[],
 *   tooLongIndices: number[],
 *   duplicateIndices: number[],
 *   clashOnlyIndices: number[],
 *   valid: boolean,
 *   summaryMessage: string,
 *   messageFor: (index: number) => string|null,
 * }}
 */
export function validateRoster(payers) {
  const solo = payers.length <= 1;
  const hostNameBlank = !solo && isBlank(payers[0]);
  const blankIndices = [];
  const tooLongIndices = [];
  const seen = new Map(); // comparison key (see name-rule.js) -> first index seen
  const duplicateIndices = [];

  payers.forEach((name, index) => {
    if (solo) return; // at people = 1 there is nothing to validate at all
    if (isBlank(name)) {
      if (index !== 0) blankIndices.push(index); // index 0's own message is hostNameBlank
      return;
    }
    if (cleanName(name).length > MAX_NAME_LEN) tooLongIndices.push(index);
    const key = nameKey(name);
    if (seen.has(key)) {
      duplicateIndices.push(index);
      duplicateIndices.push(seen.get(key)); // both rows are marked
    } else {
      seen.set(key, index);
    }
  });

  const valid =
    !hostNameBlank && blankIndices.length === 0 && tooLongIndices.length === 0 && duplicateIndices.length === 0;

  function messageFor(index) {
    if (index === 0 && hostNameBlank) return 'Add your name so friends know which one is you.';
    if (blankIndices.includes(index)) return `Add a name for person ${index + 1}.`;
    if (tooLongIndices.includes(index)) return 'Keep names to 20 characters or fewer.';
    if (duplicateIndices.includes(index)) {
      return 'Two people have the same name. Change one.';
    }
    return null;
  }

  return {
    hostNameBlank,
    blankIndices,
    tooLongIndices,
    duplicateIndices: [...new Set(duplicateIndices)].sort((a, b) => a - b),
    // Rows whose only problem is sharing a name (safe to flag early).
    clashOnlyIndices: [...new Set(duplicateIndices)]
      .filter((i) => !blankIndices.includes(i) && !tooLongIndices.includes(i))
      .sort((a, b) => a - b),
    valid,
    summaryMessage: 'Fix the names above to continue.',
    messageFor,
  };
}

/**
 * The next default label ("Person 3") that no one on the roster already
 * uses, starting from `fromNumber`. Keeps "more people" working when the
 * host has renamed someone to a default-looking name.
 */
export function nextPersonLabel(existing, fromNumber) {
  const taken = new Set(existing.map(nameKey));
  let n = fromNumber;
  while (taken.has(nameKey(`Person ${n}`))) n += 1;
  return `Person ${n}`;
}

/**
 * The collapsed one-line summary for the Review "People" row.
 * The host (first row) always reads "You"; a blank other name reads
 * "(no name)"; after the first three names the rest collapse to "+N".
 */
export function summarizeRoster(payers) {
  const shown = payers.slice(0, 3).map((name, index) => {
    if (index === 0) return 'You';
    const trimmed = typeof name === 'string' ? cleanName(name) : '';
    return trimmed.length === 0 ? '(no name)' : trimmed;
  });
  const extra = payers.length - shown.length;
  const names = extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ');
  return { count: payers.length, names, text: `People: ${payers.length} (${names})` };
}
