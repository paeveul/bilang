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
    raw: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.raw = JSON.stringify(payload);
      return this;
    },
  };
}

const validBody = () => ({ image: 'aGVsbG8=', mimeType: 'image/jpeg' });
const JSON_HEADERS = { 'content-type': 'application/json' };
const GENERIC_400_RAW = '{"error":"Bad Request"}';

async function run(method, body, headers = JSON_HEADERS) {
  const origError = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  const res = fakeRes();
  try {
    await handler({ method, body, headers }, res);
  } finally {
    console.error = origError;
    console.warn = origWarn;
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

test('signed-in POST with an unsupported image type: 400 with the original specific message, Claude not called', async () => {
  const res = await run('POST', { image: 'aGVsbG8=', mimeType: 'image/gif' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Unsupported or missing image type' });
  assert.equal(parseCalls.length, 0);
});

test('signed-in POST with an image too large: 400 with the original specific message, Claude not called', async () => {
  const huge = 'A'.repeat(8_000_001); // one character over MAX_IMAGE_BASE64_CHARS
  const res = await run('POST', { image: huge, mimeType: 'image/jpeg' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: 'Image too large — please retake the photo at a lower resolution',
  });
  assert.equal(parseCalls.length, 0);
});

test('non-POST: 405 as before, and no session check is made', async () => {
  const res = await run('GET', undefined);
  assert.equal(res.statusCode, 405);
  assert.equal(authCalls, 0);
});

// --- Content-Type check (generic 400, after the session gate) ---

test('wrong Content-Type (text/plain): generic 400, Claude not called', async () => {
  const res = await run('POST', validBody(), { 'content-type': 'text/plain' });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Bad Request' });
  assert.equal(parseCalls.length, 0);
});

test('application/json with charset is accepted', async () => {
  const res = await run('POST', validBody(), { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(res.statusCode, 200);
  assert.equal(parseCalls.length, 1);
});

test('missing Content-Type: generic 400, Claude not called', async () => {
  const res = await run('POST', validBody(), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.raw, GENERIC_400_RAW);
  assert.equal(parseCalls.length, 0);
});

test('unsigned POST with a wrong Content-Type: still 401 session_expired (gate runs first)', async () => {
  authAccountId = null;
  const res = await run('POST', validBody(), { 'content-type': 'text/plain' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'session_expired');
  assert.equal(parseCalls.length, 0);
});

test('unsigned POST with the right Content-Type: still 401 session_expired', async () => {
  authAccountId = null;
  const res = await run('POST', validBody(), JSON_HEADERS);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'session_expired');
  assert.equal(res.body.error, 'Please sign in to scan a receipt.');
});

test('format refusals (wrong and missing Content-Type) return byte-identical 400 bodies', async () => {
  const wrongType = await run('POST', validBody(), { 'content-type': 'text/plain' });
  const formUrlEncoded = await run('POST', validBody(), { 'content-type': 'application/x-www-form-urlencoded' });
  const missingType = await run('POST', validBody(), {});
  assert.equal(wrongType.statusCode, 400);
  assert.equal(formUrlEncoded.statusCode, 400);
  assert.equal(missingType.statusCode, 400);
  assert.equal(wrongType.raw, GENERIC_400_RAW);
  assert.equal(formUrlEncoded.raw, GENERIC_400_RAW);
  assert.equal(missingType.raw, GENERIC_400_RAW);
});

test('malformed body with the right Content-Type keeps its specific 400 message, not the generic body', async () => {
  const res = await run('POST', { image: 'aGVsbG8=', mimeType: 'image/gif' }, JSON_HEADERS);
  assert.equal(res.statusCode, 400);
  assert.notEqual(res.raw, GENERIC_400_RAW);
  assert.equal(res.body.error, 'Unsupported or missing image type');
});
