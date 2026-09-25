// api/split.js — Vercel serverless function
//
// GET  ?id=<id>  -> read a split's public fields (backs the read-only payer view)
// POST { items, assignments, totals, payers, ownerPaymentHandle } -> create a
//      split, returns { id, url }. The server recomputes totals.per_person from
//      items + assignments + payers and stores its own figures.
//
// This is the only file that calls the data-access layer (api/_lib/supabase.js)
// for operational data. It also fires the anonymised analytics insert (F7a)
// alongside the operational persist, per the roadmap — a second, genuinely
// de-identified dataset, not an expansion of the `splits` table.
//
// MVP-1 has no edit/re-open path (that's MVP-2/C1 scope) — splits are
// read-only after creation, so there is no admin/edit token to protect here.

const { createSplit, getSplit, insertAnalyticsRows } = require('./_lib/supabase');
const { generateSplitId, validateSplitCreateRequest } = require('./_lib/validate');
const { recomputeSplitTotals } = require('./_lib/recompute');

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGet(req, res);
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

  const { items, assignments, ownerPaymentHandle } = req.body;
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
    await createSplit({ id, items, assignments, totals, ownerPaymentHandle, expiresAt });

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
