// api/_lib/ratelimit-poll.test.mjs — Item 24 Step 5
//
// Runs entirely against a mocked global.fetch (no real Upstash instance
// reachable from this test environment). See the Step 5 report for what
// was additionally verified against a real Upstash instance.
//
// Run: node --test api/_lib/ratelimit-poll.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const originalFetch = global.fetch;
const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalError = console.error;

let calls;
let store; // in-memory stand-in for the Upstash key space
let errorLogs;

function installMockStore() {
  store = new Map();
  calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    const path = decodeURIComponent(new URL(url).pathname);
    const parts = path.split('/').filter(Boolean);
    const [command, key, ...rest] = parts;
    if (command === 'INCR') {
      const next = (store.get(key) || 0) + 1;
      store.set(key, next);
      return { ok: true, json: async () => ({ result: next }) };
    }
    if (command === 'EXPIRE') {
      return { ok: true, json: async () => ({ result: 1 }) };
    }
    throw new Error(`unexpected mock command: ${command}`);
  };
}

beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash.example.com';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';
  installMockStore();
  errorLogs = [];
  console.error = (msg) => errorLogs.push(msg);
});

afterEach(() => {
  global.fetch = originalFetch;
  console.error = originalError;
  if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
  if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
});

function freshModule() {
  // Each module load carries its own outage-logged flag; re-import via a
  // cache-busting query so outage-state tests do not leak between tests.
  const modPath = require.resolve('./ratelimit-poll.js');
  delete require.cache[modPath];
  return require('./ratelimit-poll.js');
}

function fakeReq(ip = '1.2.3.4') {
  return { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
}

test('requests under the ceiling are not limited', async () => {
  const { pollRateLimited } = freshModule();
  for (let i = 0; i < 900; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await pollRateLimited(fakeReq()), false, `request ${i + 1} should pass`);
  }
});

test('the 901st request from one key in one window is limited', async () => {
  const { pollRateLimited } = freshModule();
  let limited = false;
  for (let i = 0; i < 901; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    limited = await pollRateLimited(fakeReq());
  }
  assert.equal(limited, true);
});

test('EXPIRE fires only on the first increment in the window', async () => {
  const { pollRateLimited } = freshModule();
  await pollRateLimited(fakeReq());
  await pollRateLimited(fakeReq());
  await pollRateLimited(fakeReq());
  const expireCalls = calls.filter((url) => url.includes('/EXPIRE/'));
  assert.equal(expireCalls.length, 1);
});

test('different keys (IPs) get independent counters', async () => {
  const { pollRateLimited } = freshModule();
  for (let i = 0; i < 900; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await pollRateLimited(fakeReq('9.9.9.9'));
  }
  // A fresh IP's 1st request must not be limited by the other key's window.
  assert.equal(await pollRateLimited(fakeReq('8.8.8.8')), false);
});

test('key uses the rl:poll: prefix and the caller IP', async () => {
  const { pollRateLimited } = freshModule();
  await pollRateLimited(fakeReq('5.6.7.8'));
  assert.ok(calls[0].includes('/INCR/rl%3Apoll%3A5.6.7.8'));
});

test('a simulated store outage fails open and logs once, not per request', async () => {
  const { pollRateLimited } = freshModule();
  global.fetch = async () => {
    throw new Error('simulated network failure');
  };
  const results = [];
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await pollRateLimited(fakeReq()));
  }
  assert.deepEqual(results, [false, false, false, false, false]);
  assert.equal(errorLogs.length, 1);
});

test('outage logging resumes after a recovery (one log per outage, not once ever)', async () => {
  const { pollRateLimited } = freshModule();
  global.fetch = async () => {
    throw new Error('simulated outage 1');
  };
  await pollRateLimited(fakeReq());
  await pollRateLimited(fakeReq());
  assert.equal(errorLogs.length, 1);

  installMockStore(); // store recovers
  await pollRateLimited(fakeReq());
  assert.equal(errorLogs.length, 1); // recovery itself logs nothing

  global.fetch = async () => {
    throw new Error('simulated outage 2');
  };
  await pollRateLimited(fakeReq());
  await pollRateLimited(fakeReq());
  assert.equal(errorLogs.length, 2); // the second outage logs exactly once more
});

test('missing Upstash env vars fails open and logs once', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const { pollRateLimited } = freshModule();
  assert.equal(await pollRateLimited(fakeReq()), false);
  assert.equal(await pollRateLimited(fakeReq()), false);
  assert.equal(errorLogs.length, 1);
  assert.equal(calls.length, 0);
});
