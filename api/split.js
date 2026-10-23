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
//

const { createSplit, getSplit, claimSplitItem, insertAnalyticsRows } = require('./_lib/supabase');
const { requireAccount } = require('./_lib/auth');
const { sendBadRequest, hasJsonContentType } = require('./_lib/bad-request');
const {
  generateSplitId,
  validateSplitCreateRequest,
  receiptExactnessError,
  validateClaimRequest,
  resolveRosterName,
} = require('./_lib/validate');
const { decideClaim } = require('./_lib/claim');
const { recomputeSplitTotals } = require('./_lib/recompute');
const { pollRateLimited } = require('./_lib/ratelimit-poll');

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);
const MAX_CLAIM_ATTEMPTS = 3;

// Check order: method dispatch -> (GET/PATCH) poll limiter -> (PATCH) release
// switch CLAIMS_ENABLED -> body/query validation -> data access. POST keeps its own order inside handlePost.
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
      merchant_name: split.merchant_name ?? null,
      receipt_date: split.receipt_date ?? null,
    });
  } catch (err) {
    console.error('api/split.js GET error:', err);
    res.status(500).json({ error: 'Could not load this split. Please try again.' });
  }
}

// A copy of the assignments with any `claimed` key removed from each entry.
// Own-property copy (Object.fromEntries defines keys, so an item id such as
// "__proto__" stays an ordinary key). Plain-array entries pass through as is.
function stripClaimedFlags(assignments) {
  return Object.fromEntries(
    Object.entries(assignments).map(([itemId, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'claimed' in value) {
        const { claimed, ...rest } = value;
        return [itemId, rest];
      }
      return [itemId, value];
    })
  );
}

async function handlePost(req, res) {
  const accountId = await requireAccount(req, res);
  if (!accountId) return;

  // Content-Type check, after the session check and before body validation.
  // Refused with the generic 400 from api/_lib/bad-request.js. The reason is
  // logged on the server only and is never sent to the client.
  if (!hasJsonContentType(req)) {
    console.warn('api/split.js POST refused: request is not application/json');
    sendBadRequest(res);
    return;
  }

  const validationError = validateSplitCreateRequest(req.body);
  if (validationError) {
    console.warn('api/split.js POST refused:', validationError);
    res.status(400).json({ error: validationError });
    return;
  }

  // The receipt must add up exactly (cents, no tolerance) and no discount may
  // exceed what it comes off. Refused with a code so the screen can say why.
  const refusal = receiptExactnessError(req.body);
  if (refusal) {
    console.warn(`api/split.js POST refused: ${refusal.code}`);
    res.status(400).json({ error: refusal.error, code: refusal.code });
    return;
  }

  const { items, payers, ownerPaymentHandle, merchantName, receiptDate } = req.body;
  // `claimed` marks a payer-made claim (api/_lib/claim.js) and is set only by
  // the PATCH path. Strip it from anything the creator submits so a host-set
  // dish can never pass as a payer claim.
  const assignments = stripClaimedFlags(req.body.assignments);
  const id = generateSplitId();

  const recomputed = recomputeSplitTotals({ ...req.body, assignments });
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
    await createSplit({ id, items, assignments, totals, payers, ownerPaymentHandle, expiresAt, merchantName, receiptDate, accountId });

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

async function handlePatch(req, res) {
  if (process.env.CLAIMS_ENABLED !== 'true') {
    res.status(409).json({ code: 'claiming_unavailable' });
    return;
  }
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

      const row = await claimSplitItem(
        id,
        split.version,
        decision.assignments,
        split.items,
        split.payers,
        split.totals
      );
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
