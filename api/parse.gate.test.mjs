// api/parse.gate.test.mjs — Item 10 Step 8: POST /api/parse behind requireAccount.
//
// The real handler, with the auth layer and the Anthropic call replaced by
// stubs. No network, no Supabase, no Claude. The real requireAccount is
// covered by api/_lib/auth.test.mjs.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const authPath = require.resolve('./_lib/auth.js');
let authAccountId = 'acct-1';
let authCalls = 0;
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAccount: async (req, res) => {
      authCalls += 1;
      if (authAccountId) return authAccountId;
      res.status(401).json({ error: 'Please sign in to scan a receipt.', code: 'session_expired' });
      return null;
    },
  },
};

const anthropicPath = require.resolve('./_lib/anthropic.js');
let parseCalls = [];
require.cache[anthropicPath] = {
  id: anthropicPath,
  filename: anthropicPath,
  loaded: true,
  exports: {
    parseReceipt: async (image, mediaType) => {
      parseCalls.push({ image, mediaType });
      return {
        parsed: {
          items: [{ name: 'Nasi Lemak', category: 'food', qty: 1, unit_price: 12.5, line_total: 12.5 }],
          subtotal: 12.5,
          service_charge: 0,
          tax: 0,
          grand_total: 12.5,
        },
      };
    },
  },
};

const handler = require('./parse.js');

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

const validBody = () => ({ image: 'aGVsbG8=', mimeType: 'image/jpeg' });

async function run(method, body) {
  const origError = console.error;
  console.error = () => {};
  const res = fakeRes();
  try {
    await handler({ method, body }, res);
  } finally {
    console.error = origError;
  }
  return res;
}

beforeEach(() => {
  authAccountId = 'acct-1';
  authCalls = 0;
  parseCalls = [];
});

test('unsigned POST: 401 session_expired and Claude is never called', async () => {
  authAccountId = null;
  const res = await run('POST', validBody());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'session_expired');
  assert.equal(res.body.error, 'Please sign in to scan a receipt.');
  assert.equal(parseCalls.length, 0);
});

test('unsigned POST with a malformed body: still 401, not 400 (gate runs before validation)', async () => {
  authAccountId = null;
  const res = await run('POST', { nonsense: true });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'session_expired');
});

test('signed-in POST: behaves as before, 200 with the parsed receipt', async () => {
  const res = await run('POST', validBody());
  assert.equal(authCalls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.grand_total, 12.5);
  assert.equal(parseCalls.length, 1);
  assert.equal(parseCalls[0].mediaType, 'image/jpeg');
});

test('signed-in POST with an invalid body: 400 as before, Claude not called', async () => {
  const res = await run('POST', { image: 'aGVsbG8=', mimeType: 'image/gif' });
  assert.equal(res.statusCode, 400);
  assert.equal(parseCalls.length, 0);
});

test('non-POST: 405 as before, and no session check is made', async () => {
  const res = await run('GET', undefined);
  assert.equal(res.statusCode, 405);
  assert.equal(authCalls, 0);
});
