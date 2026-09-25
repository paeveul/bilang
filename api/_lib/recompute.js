// api/_lib/recompute.js
//
// Server-side recomputation of a split's per-person figures at create time.
// The server runs the same computeTotals() the browser uses, stores its own
// per-person figures, and reports (never rejects on) any difference from what
// the client sent.

const { computeTotals, toCents, fromCents } = require('./totals');

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
    const names = Object.keys(perPerson);
    if (names.length > 0) return { payers: names, source: 'per_person' };
  }
  return { payers: null, source: 'none' };
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
    const { perPerson } = computeTotals(body.items, body.assignments, body.totals, payers);
    const serverPerPerson = {};
    for (const name of payers) serverPerPerson[name] = fromCents(perPerson[name].totalCents);

    const { diffs, extraClient } = diffPerPerson(payers, perPerson, body.totals.per_person);
    return {
      totals: { ...body.totals, per_person: serverPerPerson },
      recomputed: true,
      source,
      mismatch: diffs.length > 0 || extraClient > 0 ? { diffs, extraClient } : null,
    };
  } catch (err) {
    return { totals: body.totals, recomputed: false, source: 'error', mismatch: null, error: err };
  }
}

module.exports = { recomputeSplitTotals };
