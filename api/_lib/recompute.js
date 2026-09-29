// api/_lib/recompute.js
//
// Server-side recomputation of a split's per-person figures at create time.
// The server runs the same computeTotals() the browser uses, stores its own
// per-person figures, and reports (never rejects on) any difference from what
// the client sent.

const { computeTotals, toCents, fromCents } = require('./totals');
const { isReservedNameKey } = require('./validate');

/**
 * Who the payers are, in display order.
 *  - `payers` sent by the client (already validated) wins.
 *  - Otherwise fall back to the keys of totals.per_person.
 *  - Otherwise null: there is nothing to compute against.
 */
function resolvePayers(body) {
  if (Array.isArray(body.payers)) {
    return { payers: body.payers, source: 'client' };
  }
  const perPerson = body.totals && body.totals.per_person;
  if (perPerson && typeof perPerson === 'object' && !Array.isArray(perPerson)) {
    // Reserved names (`__proto__`, `constructor`, `prototype`) can never be on a
    // valid roster, so a hostile per_person key is not turned into a payer.
    const names = Object.keys(perPerson).filter((name) => !isReservedNameKey(name));
    if (names.length > 0) return { payers: names, source: 'per_person' };
  }
  return { payers: null, source: 'none' };
}

/**
 * Builds the `per_person` object stored on the split, in the exact shape
 * recomputeSplitTotals and computeClaimTotals both need: one key per payer,
 * value the whole-ringgit total, defined as an own property (so a payer
 * named e.g. "constructor" is stored honestly rather than shadowing
 * Object.prototype). Shared so the two callers never format this differently.
 */
function buildStoredPerPerson(payers, perPersonCents) {
  const per_person = {};
  for (const name of payers) {
    Object.defineProperty(per_person, name, {
      value: fromCents(perPersonCents[name].totalCents),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return per_person;
}

/**
 * Compare per-person figures in whole cents. Payers are reported by position
 * (not name) so a log line carries no personal data.
 * Returns an array of {index, client, server} for every payer whose figure
 * differs, where `client` is null if the client sent no figure for them.
 * Names present in the client's per_person but not in `payers` are counted in
 * `extraClient`.
 */
function diffPerPerson(payers, serverPerPerson, clientPerPerson) {
  const client = clientPerPerson && typeof clientPerPerson === 'object' && !Array.isArray(clientPerPerson)
    ? clientPerPerson
    : {};
  const diffs = [];
  payers.forEach((name, index) => {
    const serverCents = serverPerPerson[name].totalCents;
    const hasClient = Object.prototype.hasOwnProperty.call(client, name);
    const clientCents = hasClient ? toCents(client[name]) : null;
    if (clientCents !== serverCents) {
      diffs.push({ index, client: clientCents, server: serverCents });
    }
  });
  const extraClient = Object.keys(client).filter((name) => !payers.includes(name)).length;
  return { diffs, extraClient };
}

/**
 * @param {object} body - the validated POST /api/split body
 * @returns {{
 *   totals: object,            // what to store
 *   recomputed: boolean,       // false only if there was nothing to compute against
 *   source: 'client'|'per_person'|'none'|'error',
 *   mismatch: null | {diffs: Array, extraClient: number}
 * }}
 * Never throws and never rejects: on any failure the client's totals are
 * returned unchanged and `source` is 'error'.
 */
function recomputeSplitTotals(body) {
  const { payers, source } = resolvePayers(body);
  if (!payers) {
    return { totals: body.totals, recomputed: false, source, mismatch: null };
  }
  try {
    const { perPerson, unclaimed } = computeTotals(body.items, body.assignments, body.totals, payers);
    const serverPerPerson = buildStoredPerPerson(payers, perPerson);

    const { diffs, extraClient } = diffPerPerson(payers, perPerson, body.totals.per_person);
    return {
      totals: {
        ...body.totals,
        per_person: serverPerPerson,
        unclaimed: fromCents(unclaimed.totalCents),
        unclaimed_items: fromCents(unclaimed.itemsCents),
      },
      recomputed: true,
      source,
      mismatch: diffs.length > 0 || extraClient > 0 ? { diffs, extraClient } : null,
    };
  } catch (err) {
    return { totals: body.totals, recomputed: false, source: 'error', mismatch: null, error: err };
  }
}

/**
 * Server recomputation of a split's per-person figures inside the payer-claim
 * write (Item 21 Step 4 / R6). Called from api/_lib/supabase.js's
 * claimSplitItem, immediately before the version-guarded UPDATE, so the new
 * `assignments` and the `totals` that describe them are written in the same
 * statement — a claim and its stored totals can never disagree, because
 * neither the claim nor this recomputation is stored unless the
 * compare-and-swap actually applies.
 *
 * Reuses computeTotals() (api/_lib/totals.js) — the same module the POST
 * path and the browser preview use — and the same per_person / unclaimed
 * shaping recomputeSplitTotals() uses, per Item 21 R3 ("one module, imported
 * by both"; no second money-math implementation). Items, the roster and the
 * receipt-level figures (subtotal/service_charge/tax/grand_total) do not
 * change after a split is created — only `assignments` does — so this only
 * ever recomputes `per_person`, `unclaimed` and `unclaimed_items`, spread
 * over the split's existing `totals` (which supplies the unchanged fields).
 *
 * Unlike recomputeSplitTotals(), there is no client-submitted figure to
 * compare against on a claim (C2: the PATCH body never carries `totals`), so
 * there is nothing to diff and nothing to log — and no failure is swallowed:
 * a thrown error here fails the claim request (500) rather than silently
 * storing assignments with stale totals.
 *
 * @param {Array<object>} items - the split's items (immutable after creation)
 * @param {object} assignments - the NEW assignments the claim decided on,
 *   not yet written
 * @param {object} billTotals - the split's current `totals` row (its
 *   subtotal/service_charge/tax/grand_total are carried through unchanged)
 * @param {string[]} payers - the split's roster, in display order
 * @returns {object} the complete `totals` object to store
 */
function computeClaimTotals(items, assignments, billTotals, payers) {
  const { perPerson, unclaimed } = computeTotals(items, assignments, billTotals, payers);
  return {
    ...billTotals,
    per_person: buildStoredPerPerson(payers, perPerson),
    unclaimed: fromCents(unclaimed.totalCents),
    unclaimed_items: fromCents(unclaimed.itemsCents),
  };
}

module.exports = { recomputeSplitTotals, computeClaimTotals };
