// src/screens/roster-validation.js — Item 24 Step 6: pure validation for the
// roster gate (RosterGate.jsx), mirroring the server's rule in
// api/_lib/validate.js's isValidPayersList (1-20 characters once trimmed,
// unique case-insensitively; MAX_PAYERS' hidden 200-person ceiling is a
// server-side-only concern, F5, never shown in any UI or copy). Exists so
// the gate can block Continue with the design spec's exact copy (§1.5)
// before ever reaching the server. Plain JS (no JSX), no dependencies — same
// pattern as review-validation.js.

export const MAX_NAME_LEN = 20;

const isBlank = (name) => typeof name !== 'string' || name.trim().length === 0;

/**
 * @param {string[]} payers - roster names in gate-row order; index 0 is the
 *   host's own row.
 * @returns {{
 *   hostNameBlank: boolean,
 *   blankIndices: number[],
 *   tooLongIndices: number[],
 *   duplicateIndices: number[],
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
  const seen = new Map(); // lowercased trimmed name -> first index seen
  const duplicateIndices = [];

  payers.forEach((name, index) => {
    if (solo) return; // §1.2: at people = 1 there is nothing to validate at all
    if (isBlank(name)) {
      if (index !== 0) blankIndices.push(index); // index 0's own message is hostNameBlank
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length > MAX_NAME_LEN) tooLongIndices.push(index);
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      duplicateIndices.push(index);
      duplicateIndices.push(seen.get(key)); // both rows are marked, per §1.5
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
      const name = (payers[index] || '').trim();
      return `Two people are called '${name}'. Give each a different name.`;
    }
    return null;
  }

  return {
    hostNameBlank,
    blankIndices,
    tooLongIndices,
    duplicateIndices: [...new Set(duplicateIndices)].sort((a, b) => a - b),
    valid,
    summaryMessage: 'Fix the names above to continue.',
    messageFor,
  };
}
