// src/screens/claim-row-state.js — Item 24 Step 7: pure per-row state
// computation for PayerScreen's claim UI (design spec §2.3's state table).
// Mirrors api/_lib/claim.js's isItemUnclaimed/isPayerClaim (same rule: an
// item is unclaimed only when it has no allocation at all; a host-set dish
// is anything ticked/allocated WITHOUT the `claimed:true` marker a payer's
// own claim carries) — kept here, independently, the same way
// review-validation.js mirrors api/_lib/validate.js's item rules rather
// than importing the CommonJS server file, so this stays a plain,
// dependency-free, directly browser-bundlable module. If claim.js's rule
// ever changes, change this file too (same convention as review-validation.js).
// Plain JS (no JSX), no dependencies — testable with node --test alone.

function manualAmountsOf(assignment) {
  const values = (assignment.manual && assignment.manual.values) || {};
  const amounts = {};
  for (const name of Object.keys(values)) amounts[name] = values[name] && values[name].cents;
  return amounts;
}

function equalNamesOf(assignment, roster) {
  const names = Array.isArray(assignment) ? assignment : assignment && assignment.equal;
  return Array.isArray(names) ? names.filter((name) => roster.includes(name)) : [];
}

/**
 * Largest-remainder equal split of `lineCents` across `names.length` people —
 * the same method api/_lib/totals.js's computeTotals() uses, so a shared
 * claim's "Your share" figure here matches what the server will actually
 * charge once it recomputes totals (Item 21 Step 4, already live).
 */
function equalShares(lineCents, names) {
  const share = Math.floor(lineCents / names.length);
  let remainder = lineCents - share * names.length;
  const out = {};
  names.forEach((name) => {
    out[name] = share + (remainder-- > 0 ? 1 : 0);
  });
  return out;
}

/**
 * @param {{line_total:number}} item
 * @param {*} assignment - split.assignments[item.id], or undefined
 * @param {string[]} roster
 * @param {string|null} me
 * @returns {{
 *   kind: 'unclaimed'|'mine-alone'|'mine-shared'|'other-alone'|'other-shared'|'host-set'|'host-partial',
 *   names: string[],
 *   mineIncluded: boolean,
 *   amounts: Object<string,number>|null,
 *   shareCents: number|null,
 *   truncatedNames: string[],
 *   truncatedExtra: number,
 * }}
 */
export function computeRowState(item, assignment, roster, me) {
  const lineCents = Math.round((Number(item.line_total) || 0) * 100);
  const isManual = assignment && !Array.isArray(assignment) && assignment.mode === 'manual';
  const claimed = Boolean(assignment) && !Array.isArray(assignment) && assignment.mode === 'equal' && assignment.claimed === true;

  let kind;
  let names = [];
  let amounts = null;
  let shareCents = null;

  if (isManual) {
    amounts = manualAmountsOf(assignment);
    const allocatedNames = Object.keys(amounts).filter(
      (name) => roster.includes(name) && Math.round(Number(amounts[name]) || 0) > 0
    );
    if (allocatedNames.length === 0) {
      kind = 'unclaimed';
    } else {
      const allocatedCents = allocatedNames.reduce((sum, n) => sum + Math.round(Number(amounts[n]) || 0), 0);
      kind = allocatedCents < lineCents ? 'host-partial' : 'host-set';
      names = allocatedNames;
    }
  } else if (claimed) {
    names = equalNamesOf(assignment, roster);
    if (names.length === 0) {
      kind = 'unclaimed';
    } else {
      const mine = me !== null && names.includes(me);
      if (names.length === 1) {
        kind = mine ? 'mine-alone' : 'other-alone';
      } else {
        kind = mine ? 'mine-shared' : 'other-shared';
        if (mine) shareCents = equalShares(lineCents, names)[me];
      }
    }
  } else {
    names = equalNamesOf(assignment, roster);
    kind = names.length === 0 ? 'unclaimed' : 'host-set';
  }

  const mineIncluded = me !== null && names.includes(me);
  const truncatedNames = names.length > 3 ? names.slice(0, 2) : names;
  const truncatedExtra = names.length > 3 ? names.length - 2 : 0;

  return { kind, names, mineIncluded, amounts, shareCents, truncatedNames, truncatedExtra };
}

/**
 * §2.3 "Ben, Chloe +2" truncation rule, shared by the "shared, not me" row
 * and the just-claimed conflict note (P12b) — never truncates to a single
 * name, only ever appends a "+N" after the first two.
 */
export function namesList(names) {
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}
