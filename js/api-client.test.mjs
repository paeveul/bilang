// js/api-client.test.mjs — Item 10 Checkpoint 3, Step 9.
// fetch is stubbed. Covers the credentials change and the typed session_expired error.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseReceipt,
  createSplit,
  getSplit,
  patchSplit,
  PatchSplitError,
  SessionExpiredError,
} from './api-client.js';

const realFetch = globalThis.fetch;
let calls;
let nextResponse;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
  nextResponse = () => jsonResponse(200, {});
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return nextResponse();
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('every api call sends credentials same-origin', async () => {
  nextResponse = () => jsonResponse(200, { parsed: {} });
  await parseReceipt('aGVsbG8=', 'image/jpeg').catch(() => {});
  nextResponse = () => jsonResponse(201, { id: 'x', url: '/s/x' });
  await createSplit({ items: [] });
  nextResponse = () => jsonResponse(200, { id: 'x' });
  await getSplit('x');
  nextResponse = () => jsonResponse(200, { version: 1 });
  await patchSplit('x', { action: 'claim', itemId: 'i', payer: 'Ali' });
  assert.equal(calls.length, 4);
  for (const c of calls) assert.equal(c.init.credentials, 'same-origin', c.url);
});

test('parseReceipt 401 session_expired throws SessionExpiredError with the server message', async () => {
  nextResponse = () =>
    jsonResponse(401, { error: 'Please sign in to scan a receipt.', code: 'session_expired' });
  await assert.rejects(parseReceipt('aGVsbG8=', 'image/jpeg'), (err) => {
    assert.ok(err instanceof SessionExpiredError);
    assert.equal(err.code, 'session_expired');
    assert.equal(err.message, 'Please sign in to scan a receipt.');
    return true;
  });
});

test('createSplit 401 session_expired throws SessionExpiredError', async () => {
  nextResponse = () =>
    jsonResponse(401, { error: 'Please sign in to scan a receipt.', code: 'session_expired' });
  await assert.rejects(createSplit({ items: [] }), (err) => err instanceof SessionExpiredError);
});

test('an ordinary failure stays a plain Error, not a SessionExpiredError', async () => {
  nextResponse = () => jsonResponse(500, { error: 'Could not create this split. Please try again.' });
  await assert.rejects(createSplit({ items: [] }), (err) => {
    assert.equal(err instanceof SessionExpiredError, false);
    assert.equal(err.message, 'Could not create this split. Please try again.');
    return true;
  });
});

test('patchSplit 401 session_expired still throws PatchSplitError carrying the code', async () => {
  nextResponse = () => jsonResponse(401, { code: 'session_expired' });
  await assert.rejects(patchSplit('x', { action: 'claim' }), (err) => {
    assert.ok(err instanceof PatchSplitError);
    assert.equal(err.status, 401);
    assert.equal(err.code, 'session_expired');
    return true;
  });
});

test('getSplit stays anonymous: a normal 200 comes back unchanged', async () => {
  nextResponse = () => jsonResponse(200, { id: 'abc', version: 2 });
  const split = await getSplit('abc');
  assert.deepEqual(split, { id: 'abc', version: 2 });
  assert.equal(calls[0].url, '/api/v1/split?id=abc');
});
