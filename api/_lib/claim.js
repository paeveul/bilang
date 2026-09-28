// api/_lib/claim.js
//
// Pure decision logic for PATCH /api/split (Item 24): given a split's current
// assignments and one claim request, decide what should happen. No I/O, no
// database, no HTTP - api/split.js does the reading and writing.
//
// Assignment shapes it understands are the ones computeTotals() understands:
// no entry, a plain array of names, { mode: 'equal', equal: [...] } and
// { mode: 'manual', ... } (host-set amounts).
//
// A claim is stored as { mode: 'equal', equal: [names], manual: {...},
// claimed: true }. The `claimed` flag is the only thing that tells a
// payer-made claim from a dish the host assigned; only flagged items can be
// un-claimed or re-tapped. computeTotals() ignores the flag.

// Positive cents on a manual assignment, per name. Reads the same two shapes
// computeTotals() reads ({ amounts } and { manual: { values } }); kept here
// because totals.js and js/totals.js must keep identical exports. The
// cross-check test in claim.test.mjs fails if this drifts from computeTotals.
function manualAmountsOf(assignment) {
  if (assignment.amounts) return assignment.amounts;
  const values = (assignment.manual && assignment.manual.values) || {};
  const amounts = Object.create(null); // no prototype: a "__proto__" key stays an ordinary entry
  for (const name of Object.keys(values)) amounts[name] = values[name] && values[name].cents;
  return amounts;
}

// Names on an equal-split assignment that are actually on the roster.
function equalNamesOf(assignment, roster) {
  const names = Array.isArray(assignment) ? assignment : assignment && assignment.equal;
  return Array.isArray(names) ? names.filter((name) => roster.includes(name)) : [];
}

/**
 * True when the item has no allocation at all: no entry, no roster name on an
 * equal split, or a manual split with no positive amount for a roster name.
 * This mirrors how computeTotals() decides what is unclaimed, so the two
 * cannot disagree (a test cross-checks them). The leftover on a partly
 * allocated manual dish is NOT unclaimed.
 */
function isItemUnclaimed(assignment, roster) {
  if (!assignment) return true;
  if (!Array.isArray(assignment) && assignment.mode === 'manual') {
    const amounts = manualAmountsOf(assignment);
    return !Object.keys(amounts).some(
      (name) => roster.includes(name) && Math.round(Number(amounts[name]) || 0) > 0
    );
  }
  return equalNamesOf(assignment, roster).length === 0;
}

// A payer-made claim (as opposed to a host-assigned dish).
function isPayerClaim(assignment) {
  return Boolean(assignment) && !Array.isArray(assignment) && assignment.mode === 'equal' && assignment.claimed === true;
}

/**
 * @param {{assignments: object, payers: string[]}} split - as read from the database
 * @param {{action: 'claim'|'unclaim', itemId: string, names: string[]}} claim
 *   `names` are roster spellings, `names[0]` being the caller (the payer);
 *   for `unclaim` it holds only the caller.
 * @returns {{outcome: 'applied', assignments: object}
 *   | {outcome: 'unchanged'}          nothing to write (repeat tap, or nothing to undo)
 *   | {outcome: 'already_claimed'}    the item belongs to someone else
 *   | {outcome: 'not_your_claim'}}    un-claim of something that is not the caller's
 */
function decideClaim(split, claim) {
  const roster = split.payers;
  const assignments = split.assignments || {};
  const current = Object.prototype.hasOwnProperty.call(assignments, claim.itemId)
    ? assignments[claim.itemId]
    : undefined;
  const [caller] = claim.names;

  if (claim.action === 'claim') {
    if (isItemUnclaimed(current, roster)) {
      return {
        outcome: 'applied',
        assignments: {
          ...assignments,
          [claim.itemId]: { mode: 'equal', equal: [...claim.names], manual: { unit: 'RM', values: {} }, claimed: true },
        },
      };
    }
    if (isPayerClaim(current)) {
      const onItem = equalNamesOf(current, roster);
      if (claim.names.every((name) => onItem.includes(name))) return { outcome: 'unchanged' };
    }
    return { outcome: 'already_claimed' };
  }

  // unclaim: a person may remove only their own name, and only from a claim
  if (isItemUnclaimed(current, roster)) return { outcome: 'unchanged' };
  if (!isPayerClaim(current) || !equalNamesOf(current, roster).includes(caller)) {
    return { outcome: 'not_your_claim' };
  }
  const remaining = current.equal.filter((name) => name !== caller);
  const next = { ...assignments };
  if (remaining.some((name) => roster.includes(name))) {
    next[claim.itemId] = { ...current, equal: remaining };
  } else {
    delete next[claim.itemId]; // everyone removed themselves: unclaimed again
  }
  return { outcome: 'applied', assignments: next };
}

module.exports = { decideClaim, isItemUnclaimed };
