// api/split.js — Vercel serverless function
//
// GET  ?id=<id>  -> read a split's public fields (backs the read-only payer view)
// PATCH ?id=<id> { action, itemId, payer, sharedWith? } -> claim or un-claim one
//      item for a payer on the split's roster (compare-and-swap on
//      splits.version; see handlePatch).
// POST { items, assignments, totals, payers, ownerPaymentHandle } -> create a
//      split, returns { id, url }. The server recomputes totals.per_person from
//      items + assignments + payers and stores its own figures.
//
// This is the only file that calls the data-access layer (api/_lib/supabase.js)
// for operational data. It also fires the anonymised analytics insert (F7a)
// alongside the operational persist, per the roadmap — a second, genuinely
// de-identified dataset, not an expansion of the `splits` table.
//
// MVP-1 has no creator edit/re-open path (that's MVP-2/C1 scope). The only
// write after creation is a payer claiming or un-claiming one item (PATCH),
// which is anonymous by design (Item 24 C7/C13): the payer picks a name from
// the stored roster and nothing more is checked.

const { createSplit, getSplit, claimSplitItem, insertAnalyticsRows } = require('./_lib/supabase');
const {
  generateSplitId,
  validateSplitCreateRequest,
  validateClaimRequest,
  resolveRosterName,
} = require('./_lib/validate');
const { decideClaim } = require('./_lib/claim');
const { recomputeSplitTotals } = require('./_lib/recompute');

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const MAX_CLAIM_ATTEMPTS = 3;

// Polling limiter slot (Item 24 Step 5). GET and PATCH share one limiter,
// api/_lib/ratelimit-poll.js, which does not exist yet: until Step 5 replaces
// this body, nothing is ever limited and the 429 branch below cannot fire.
// Must resolve true when the request should be refused.
async function pollRateLimited(req) {
  return false;
}

// Check order: method dispatch -> (GET/PATCH) poll limiter -> body/query
// validation -> data access. POST keeps its own order inside handlePost.
module.exports = async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'PATCH') {
    if (await pollRateLimited(req)) {
      res.status(429).json({ code: 'rate_limited' });
      return;
    }
    return req.method === 'GET' ? handleGet(req, res) : handlePatch(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  res.status(405).json({ error: 'Method not allowed' });
};

async function handleGet(req, res) {
  const id = String(req.query.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }
  try {
    const split = await getSplit(id);
    if (!split) {
      res.status(404).json({ error: 'This split was not found, or has expired.' });
      return;
    }
    // Only ever return the public, benign fields — never anything that
    // wouldn't already be visible to anyone holding the share link.
    res.status(200).json({
      id: split.id,
      items: split.items,
      assignments: split.assignments,
      totals: split.totals,
      payers: split.payers ?? null,
      version: split.version ?? 0,
      ownerPaymentHandle: split.owner_payment_handle,
      createdAt: split.created_at,
    });
  } catch (err) {
    console.error('api/split.js GET error:', err);
    res.status(500).json({ error: 'Could not load this split. Please try again.' });
  }
}

async function handlePost(req, res) {
  const validationError = validateSplitCreateRequest(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { items, assignments, payers, ownerPaymentHandle } = req.body;
  const id = generateSplitId();

  const recomputed = recomputeSplitTotals(req.body);
  const totals = recomputed.totals;
  if (recomputed.source === 'per_person') {
    console.log(`split ${id}: payers not sent, derived from totals.per_person`);
  } else if (recomputed.source === 'none') {
    console.log(`split ${id}: no payers and no totals.per_person, stored client totals unchanged`);
  } else if (recomputed.source === 'error') {
    console.error(`split ${id}: totals recomputation failed, stored client totals unchanged:`, recomputed.error);
  }
  if (recomputed.mismatch) {
    console.warn(
      `split ${id}: totals mismatch (client vs server, cents, by payer position): ${JSON.stringify(recomputed.mismatch)}`
    );
  }
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    await createSplit({ id, items, assignments, totals, payers, ownerPaymentHandle, expiresAt });

    // Roadmap F7(a) — anonymised analytics capture, MVP-1 scope. Fire-and-
    // forget, alongside (not instead of) the operational persist above. No
    // name, no payment handle, no reversible link back to this split's id —
    // see supabase/schema.sql for why that's a hard requirement, not a nicety.
    const analyticsRows = items.map((item) => ({
      item_category: item.category || 'other',
      amount: item.line_total,
    }));
    insertAnalyticsRows(analyticsRows).catch((err) => {
      console.error('analytics insert failed (non-fatal):', err);
    });

    res.status(201).json({ id, url: `/s/${id}` });
  } catch (err) {
    console.error('api/split.js POST error:', err);
    res.status(500).json({ error: 'Could not create this split. Please try again.' });
  }
}

/**
 * Claim or un-claim one item. Read the row, decide in api/_lib/claim.js, then
 * write with claimSplitItem, which applies only if `version` has not moved
 * since the read. A lost race is re-read and re-decided (max 3 attempts); if
 * the item was taken meanwhile the re-decision is a calm 409. Stored `totals`
 * are returned as stored: recomputing them inside this write is Item 21
 * Step 4, which lands directly after this item.
 */
async function handlePatch(req, res) {
  const id = String(req.query.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }
  const shapeError = validateClaimRequest(req.body);
  if (shapeError) {
    res.status(400).json({ error: shapeError });
    return;
  }

  try {
    let claim = null;
    for (let attempt = 1; attempt <= MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const split = await getSplit(id);
      if (!split) {
        res.status(404).json({ error: 'This split was not found, or has expired.' });
        return;
      }
      if (!Array.isArray(split.payers) || typeof split.version !== 'number') {
        res.status(409).json({ code: 'claiming_unavailable' });
        return;
      }
      if (!claim) {
        // Items and roster never change after creation, so this runs once.
        const error = validateClaimRequest(req.body, split);
        if (error) {
          res.status(400).json({ error });
          return;
        }
        const named = [req.body.payer, ...(req.body.sharedWith || [])];
        claim = {
          action: req.body.action,
          itemId: req.body.itemId,
          names: named.map((name) => resolveRosterName(split.payers, name)),
        };
      }

      const current = { assignments: split.assignments, totals: split.totals, version: split.version };
      const decision = decideClaim(split, claim);
      if (decision.outcome === 'unchanged') {
        res.status(200).json(current);
        return;
      }
      if (decision.outcome === 'already_claimed') {
        res.status(409).json({ code: 'already_claimed', ...current });
        return;
      }
      if (decision.outcome === 'not_your_claim') {
        res.status(403).json({ code: 'not_your_claim' });
        return;
      }

      const row = await claimSplitItem(id, split.version, decision.assignments);
      if (row) {
        res.status(200).json({ assignments: row.assignments, totals: row.totals, version: row.version });
        return;
      }
      // Lost the race: the version moved. Loop to re-read and re-decide.
    }
    res.status(503).json({ code: 'busy' });
  } catch (err) {
    console.error('api/split.js PATCH error:', err);
    res.status(500).json({ error: 'Could not save this claim. Please try again.' });
  }
}
