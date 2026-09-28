// api/split.patch.test.mjs — PATCH /api/split end to end through the real
// handler, with the data-access layer replaced by an in-memory stub that has
// real compare-and-swap semantics on `version`.
//
// The real-database checks (a hand-run claim, ten concurrent races against
// Postgres) cannot run until the migration is applied; the races here are
// simulated in memory and prove the handler's logic, not Postgres.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const supabasePath = require.resolve('./_lib/supabase.js');

let row = null; // the one stored split
let writes = 0; // successful compare-and-swap writes
let casAttempts = 0;
let beforeRead = async () => {}; // hook: runs inside getSplit, before the row is copied
let alwaysLose = false; // hook: every compare-and-swap loses

const clone = (v) => JSON.parse(JSON.stringify(v));

require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    createSplit: async () => {},
    insertAnalyticsRows: async () => {},
    getSplit: async () => {
      await beforeRead();
      return row ? clone(row) : null;
    },
    claimSplitItem: async (id, expectedVersion, assignments) => {
      casAttempts += 1;
      await Promise.resolve();
      if (alwaysLose) {
        row.version += 1; // someone else keeps writing
        return null;
      }
      if (!row || row.id !== id || row.version !== expectedVersion) return null;
      row.assignments = clone(assignments);
      row.version = expectedVersion + 1;
      writes += 1;
      return clone({ assignments: row.assignments, totals: row.totals, version: row.version });
    },
  },
};
const handler = require('./split.js');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function call(method, body, id = 'abc') {
  const res = fakeRes();
  const errors = console.error;
  console.error = () => {};
  try {
    await handler({ method, query: id === null ? {} : { id }, body }, res);
  } finally {
    console.error = errors;
  }
  return res;
}
const patch = (body, id) => call('PATCH', body, id);
const claim = (payer, itemId = 'i1', extra = {}) => ({ action: 'claim', itemId, payer, ...extra });

// CLAIMS_ENABLED is read at request time and defaults off. Every test here
// sets it explicitly and restores the caller's value afterwards, so nothing
// leaks in or out.
const savedClaimsEnabled = process.env.CLAIMS_ENABLED;
afterEach(() => {
  if (savedClaimsEnabled === undefined) delete process.env.CLAIMS_ENABLED;
  else process.env.CLAIMS_ENABLED = savedClaimsEnabled;
});

beforeEach(() => {
  process.env.CLAIMS_ENABLED = 'true';
  writes = 0;
  casAttempts = 0;
  beforeRead = async () => {};
  alwaysLose = false;
  row = {
    id: 'abc',
    items: [
      { id: 'i1', name: 'Nasi', category: 'food', qty: 1, unit_price: 10, line_total: 10 },
      { id: 'i2', name: 'Teh', category: 'drink', qty: 1, unit_price: 4, line_total: 4 },
      { id: 'i3', name: 'Ikan', category: 'food', qty: 1, unit_price: 20, line_total: 20 },
      { id: 'i4', name: 'Set', category: 'food', qty: 1, unit_price: 10, line_total: 10 },
    ],
    assignments: {
      i3: ['Cy'], // host-assigned
      i4: { mode: 'manual', equal: [], manual: { unit: 'RM', values: { Cy: { text: '3', cents: 300 } } } },
    },
    totals: { subtotal: 44, service_charge: 0, tax: 0, grand_total: 44 },
    payers: ['Ali', 'Bea', 'Cy'],
    version: 0,
  };
});

// ---- response table, one row at a time ----

test('200: claim applied, version +1, body { assignments, totals, version }', async () => {
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['assignments', 'totals', 'version']);
  assert.equal(res.body.version, 1);
  assert.deepEqual(res.body.assignments.i1.equal, ['Ali']);
  assert.deepEqual(res.body.totals, row.totals);
  assert.equal(row.version, 1);
});

test('200: roster spelling is written even if the request spells it differently', async () => {
  const res = await patch(claim('  bea ', 'i1', { sharedWith: ['ALI'] }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.assignments.i1.equal, ['Bea', 'Ali']);
});

test('200: repeat tap by a payer already on the item, same body, no version change', async () => {
  await patch(claim('Ali'));
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.version, 1);
  assert.equal(writes, 1);
});

test('409 already_claimed: taken by someone else, body carries current state', async () => {
  await patch(claim('Ali'));
  const res = await patch(claim('Bea'));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'already_claimed');
  assert.equal(res.body.version, 1);
  assert.deepEqual(res.body.assignments.i1.equal, ['Ali']);
  assert.equal(writes, 1);
});

test('409 already_claimed: host-assigned, Set-amounts (partly allocated) dishes are locked', async () => {
  for (const itemId of ['i3', 'i4']) {
    const res = await patch(claim('Ali', itemId));
    assert.equal(res.statusCode, 409, itemId);
    assert.equal(res.body.code, 'already_claimed');
  }
  assert.equal(writes, 0);
  assert.equal(row.version, 0);
});

test('403 not_your_claim: removing someone else\'s name changes nothing', async () => {
  await patch(claim('Ali', 'i1', { sharedWith: ['Bea'] }));
  const res = await patch({ action: 'unclaim', itemId: 'i1', payer: 'Cy' });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { code: 'not_your_claim' });
  assert.equal(row.version, 1);
});

test('unclaim: shared claim keeps the others; last person out makes it unclaimed again', async () => {
  await patch(claim('Ali', 'i1', { sharedWith: ['Bea'] }));
  let res = await patch({ action: 'unclaim', itemId: 'i1', payer: 'Bea' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.assignments.i1.equal, ['Ali']);
  res = await patch({ action: 'unclaim', itemId: 'i1', payer: 'Ali' });
  assert.equal(res.statusCode, 200);
  assert.equal('i1' in res.body.assignments, false);
  assert.equal(res.body.version, 3);
});

test('400: bad action, unknown item, name off the roster, duplicates, unknown fields, too large, missing id', async () => {
  const bad = [
    { action: 'delete', itemId: 'i1', payer: 'Ali' },
    claim('Ali', 'nope'),
    claim('Zed'),
    claim('Ali', 'i1', { sharedWith: ['Ali'] }),
    claim('Ali', 'i1', { sharedWith: ['Zed'] }),
    claim('Ali', 'i1', { totals: { grand_total: 0 } }),
    claim('Ali', 'i1', { assignments: {} }),
    claim('x'.repeat(21)),
    claim('Ali', 'i'.repeat(20000)),
    null,
    'text',
  ];
  for (const body of bad) {
    const res = await patch(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body)?.slice(0, 60));
    assert.equal(typeof res.body.error, 'string');
  }
  assert.equal((await patch(claim('Ali'), '')).statusCode, 400);
  assert.equal((await patch(claim('Ali'), null)).statusCode, 400);
  assert.equal(writes, 0);
});

test('404: split not found or expired', async () => {
  row = null;
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /not found, or has expired/);
});

test('409 claiming_unavailable: split has no roster (created before the migration)', async () => {
  row.payers = null;
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { code: 'claiming_unavailable' });
  delete row.payers;
  delete row.version; // a database without the columns
  assert.equal((await patch(claim('Ali'))).statusCode, 409);
  assert.equal(writes, 0);
});

test('503 busy: the compare-and-swap keeps losing, gives up after 3 attempts', async () => {
  alwaysLose = true;
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { code: 'busy' });
  assert.equal(casAttempts, 3);
});

test('500: a data-layer failure is a plain error, no internals', async () => {
  beforeRead = async () => {
    throw new Error('boom secret');
  };
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /boom|secret/);
});

test('405 for other methods; GET still works and returns roster and version', async () => {
  assert.equal((await call('DELETE', undefined)).statusCode, 405);
  const res = await call('GET', undefined);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.payers, ['Ali', 'Bea', 'Cy']);
  assert.equal(res.body.version, 0);
});

test('429 rate_limited cannot fire yet: the limiter slot is a no-op until Item 24 Step 5', async () => {
  // Documents the placeholder. Step 5 replaces this test with 901 requests -> 429.
  for (let i = 0; i < 5; i += 1) assert.notEqual((await patch(claim('Ali'))).statusCode, 429);
});

test('anonymous: no cookie or Authorization header is needed or read', async () => {
  const res = fakeRes();
  await handler({ method: 'PATCH', query: { id: 'abc' }, body: claim('Ali'), headers: {} }, res);
  assert.equal(res.statusCode, 200);
});

// ---- simulated collisions ----

test('collision: two claims race on the SAME item, ten runs, one wins and one gets calm 409', async () => {
  for (let run = 0; run < 10; run += 1) {
    row.assignments = {};
    row.version = 0;
    writes = 0;
    // Make both requests read before either writes, in both orders.
    let readers = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    beforeRead = async () => {
      readers += 1;
      if (readers <= 2) {
        if (readers === 2) release();
        await gate;
      }
    };
    const pair = run % 2 === 0 ? ['Ali', 'Bea'] : ['Bea', 'Ali'];
    const [a, b] = await Promise.all(pair.map((p) => patch(claim(p))));
    const statuses = [a.statusCode, b.statusCode].sort();
    assert.deepEqual(statuses, [200, 409], `run ${run}`);
    const loser = a.statusCode === 409 ? a : b;
    const winner = a.statusCode === 200 ? a : b;
    assert.equal(loser.body.code, 'already_claimed');
    assert.equal(loser.body.assignments.i1.equal.length, 1);
    assert.deepEqual(loser.body.assignments.i1.equal, winner.body.assignments.i1.equal);
    assert.equal(row.version, 1, `run ${run}`);
    assert.equal(writes, 1);
    assert.equal(row.assignments.i1.equal.length, 1);
  }
});

test('collision: two claims on DIFFERENT items both succeed; the retry keeps both, version 2', async () => {
  for (let run = 0; run < 10; run += 1) {
    row.assignments = {};
    row.version = 0;
    writes = 0;
    casAttempts = 0;
    let readers = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    beforeRead = async () => {
      readers += 1;
      if (readers <= 2) {
        if (readers === 2) release();
        await gate;
      }
    };
    const [a, b] = await Promise.all([patch(claim('Ali', 'i1')), patch(claim('Bea', 'i2'))]);
    assert.deepEqual([a.statusCode, b.statusCode], [200, 200], `run ${run}`);
    assert.deepEqual(row.assignments.i1.equal, ['Ali']);
    assert.deepEqual(row.assignments.i2.equal, ['Bea']);
    assert.equal(row.version, 2);
    assert.equal(writes, 2);
    assert.equal(casAttempts, 3); // one lost, retried once
  }
});

test('collision: a claim that loses to an UNCLAIM on the same item re-decides from fresh state', async () => {
  await patch(claim('Ali'));
  let readers = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  beforeRead = async () => {
    readers += 1;
    if (readers <= 2) {
      if (readers === 2) release();
      await gate;
    }
  };
  const [a, b] = await Promise.all([
    patch({ action: 'unclaim', itemId: 'i1', payer: 'Ali' }),
    patch(claim('Bea')),
  ]);
  // Bea read the item as claimed by Ali (409 straight away) or, after Ali's
  // unclaim landed, as free (200). Either way the stored state is consistent.
  assert.equal(a.statusCode, 200);
  assert.ok([200, 409].includes(b.statusCode));
  const stored = row.assignments.i1;
  if (b.statusCode === 200) assert.deepEqual(stored.equal, ['Bea']);
  else assert.equal(stored, undefined);
});

// ---- release switch (CLAIMS_ENABLED, default off) ----

test('switch: unset means off, 409 claiming_unavailable, and the claim state is never read or written', async () => {
  delete process.env.CLAIMS_ENABLED;
  let reads = 0;
  beforeRead = async () => {
    reads += 1;
  };
  const res = await patch(claim('Ali'));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { code: 'claiming_unavailable' });
  assert.equal(reads, 0);
  assert.equal(casAttempts, 0);
  assert.equal(writes, 0);
  assert.equal(row.version, 0);
  // Off also answers before validation and before the split lookup.
  assert.equal((await patch(null)).statusCode, 409);
  assert.equal((await patch(claim('Ali'), '')).statusCode, 409);
});

test('switch: only the exact string "true" turns claiming on', async () => {
  for (const value of ['1', 'TRUE', 'True', 'yes', 'on', ' true', 'true ', '']) {
    process.env.CLAIMS_ENABLED = value;
    const res = await patch(claim('Ali'));
    assert.equal(res.statusCode, 409, JSON.stringify(value));
    assert.deepEqual(res.body, { code: 'claiming_unavailable' });
  }
  assert.equal(writes, 0);
  process.env.CLAIMS_ENABLED = 'true';
  assert.equal((await patch(claim('Ali'))).statusCode, 200);
  assert.equal(writes, 1);
});

test('switch: GET and POST are unaffected when claiming is off', async () => {
  delete process.env.CLAIMS_ENABLED;
  assert.equal((await call('GET', undefined)).statusCode, 200);
  assert.equal((await call('DELETE', undefined)).statusCode, 405);
  assert.equal((await call('POST', {})).statusCode, 400); // POST still reaches its own validation
});
