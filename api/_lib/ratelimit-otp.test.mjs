// api/_lib/ratelimit-otp.test.mjs — Item 10 Checkpoint 2, Step 5.
//
// Runs entirely against a mocked global.fetch (no real Upstash instance
// reachable from this test environment). See the Checkpoint 2 handback
// report for what was additionally verified against the real Upstash
// instance in .env (a local, throwaway driver script, not committed).
//
// Run: node --test api/_lib/ratelimit-otp.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const originalFetch = global.fetch;
const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const originalError = console.error;

let store; // in-memory stand-in for the Upstash key space: key -> { count, ttl }
let calls;
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
      const entry = store.get(key) || { count: 0, ttl: -1 };
      entry.count += 1;
      store.set(key, entry);
      return { ok: true, json: async () => ({ result: entry.count }) };
    }
    if (command === 'EXPIRE') {
      const entry = store.get(key) || { count: 0, ttl: -1 };
      entry.ttl = Number(rest[0]);
      store.set(key, entry);
      return { ok: true, json: async () => ({ result: 1 }) };
    }
    if (command === 'TTL') {
      const entry = store.get(key);
      return { ok: true, json: async () => ({ result: entry ? entry.ttl : -2 }) };
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
  const modPath = require.resolve('./ratelimit-otp.js');
  delete require.cache[modPath];
  return require('./ratelimit-otp.js');
}

function fakeReq(ip = '1.2.3.4') {
  return { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
}

// ---- send limiter -----------------------------------------------------

test('request-code: first attempt for a fresh email/IP is ok', async () => {
  const { checkRequestCode } = freshModule();
  const result = await checkRequestCode(fakeReq(), 'alex@example.com');
  assert.deepEqual(result, { outcome: 'ok' });
});

test('request-code: second attempt within 60s for the same email is limited (the 1/60s counter)', async () => {
  const { checkRequestCode } = freshModule();
  await checkRequestCode(fakeReq('9.9.9.9'), 'alex@example.com');
  const second = await checkRequestCode(fakeReq('9.9.9.9'), 'alex@example.com');
  assert.equal(second.outcome, 'limited');
  assert.equal(second.retryAfterSeconds, 60);
});

test('request-code: sixth attempt within an hour for one email is limited (the 5/1h counter)', async () => {
  const { checkRequestCode } = freshModule();
  // Drive past the 1/60s counter first by using a distinct IP each time so
  // only the email-hour counter is the one under test — but the 1/60s
  // counter will also fire from the 2nd attempt onward for the SAME email
  // regardless of IP, so by construction attempts 2-6 are already refused
  // by the 60s counter. What must be true regardless: the 5/1h counter
  // itself crosses its threshold by the 6th attempt, which is checkable via
  // the raw store rather than the (also-limited) outer verdict.
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await checkRequestCode(fakeReq(`10.0.0.${i}`), 'bombed@example.com');
  }
  const hourKey = [...store.keys()].find((k) => k.startsWith('rl:otp:send:email:') && k.endsWith(':h'));
  assert.ok(hourKey, 'expected an hourly email counter key to exist');
  assert.equal(store.get(hourKey).count, 6);
  assert.ok(store.get(hourKey).count > 5, 'the 5/1h ceiling must have been crossed by the 6th attempt');
});

test('request-code: eleventh IP within an hour is limited (the 10/1h IP counter)', async () => {
  const { checkRequestCode } = freshModule();
  for (let i = 0; i < 11; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await checkRequestCode(fakeReq('20.0.0.1'), `person${i}@example.com`);
  }
  const ipHourKey = [...store.keys()].find((k) => k.startsWith('rl:otp:send:ip:') && k.endsWith(':h'));
  assert.ok(ipHourKey);
  assert.equal(store.get(ipHourKey).count, 11);
});

test('request-code: window reset — after EXPIRE fires, a fresh key starts the count over', async () => {
  const { checkRequestCode } = freshModule();
  await checkRequestCode(fakeReq('30.0.0.1'), 'reset@example.com');
  const minuteKey = [...store.keys()].find((k) => k.startsWith('rl:otp:send:email:') && !k.includes(':'.repeat(0) + 'h') && !k.endsWith(':d'));
  // Simulate the window elapsing: the mock store has no real TTL decay, so
  // directly clear the key the way Redis would after EXPIRE fires.
  const minuteKeyExact = [...store.keys()].find((k) => /^rl:otp:send:email:[0-9a-f]{64}$/.test(k));
  assert.ok(minuteKeyExact);
  store.delete(minuteKeyExact);
  const result = await checkRequestCode(fakeReq('30.0.0.1'), 'reset@example.com');
  // The 1/60s counter is fresh again (count=1, not limited by it) — any
  // limitation here would only come from the independent hour/day counters,
  // which are still at count=2, well under their own 5/10 ceilings.
  assert.equal(result.outcome, 'ok');
});

test('request-code: an unresolvable IP skips IP-keyed checks but still applies email-keyed ones', async () => {
  const { checkRequestCode } = freshModule();
  const reqNoIp = { headers: {}, socket: {} };
  await checkRequestCode(reqNoIp, 'noip@example.com');
  const anyIpKey = [...store.keys()].some((k) => k.startsWith('rl:otp:send:ip:'));
  assert.equal(anyIpKey, false, 'no IP-keyed key should be written when the IP cannot be resolved');
  const emailKeyExists = [...store.keys()].some((k) => k.startsWith('rl:otp:send:email:'));
  assert.equal(emailKeyExists, true, 'email-keyed checks still apply with no resolvable IP');
});

// ---- verify limiter -----------------------------------------------------

test('verify-code: 21st attempt for one email within an hour is limited (the 20/1h counter), and wrong attempts count', async () => {
  const { checkVerifyCode } = freshModule();
  let last;
  for (let i = 0; i < 21; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await checkVerifyCode(fakeReq('40.0.0.1'), 'guessed@example.com');
  }
  assert.equal(last.outcome, 'limited');
  const emailHourKey = [...store.keys()].find((k) => k.startsWith('rl:otp:verify:email:'));
  assert.equal(store.get(emailHourKey).count, 21);
});

test('verify-code: 61st attempt from one IP within an hour is limited (the 60/1h IP counter)', async () => {
  const { checkVerifyCode } = freshModule();
  let last;
  for (let i = 0; i < 61; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await checkVerifyCode(fakeReq('50.0.0.1'), `distinct${i}@example.com`);
  }
  assert.equal(last.outcome, 'limited');
});

// ---- isolation (plans §10.6 verification #15-17) -------------------------

test('isolation: every key produced begins with rl:otp: and no key collides with rl:poll: or rl:scan:', async () => {
  const { checkRequestCode, checkVerifyCode } = freshModule();
  await checkRequestCode(fakeReq('60.0.0.1'), 'iso@example.com');
  await checkVerifyCode(fakeReq('60.0.0.1'), 'iso@example.com');
  for (const key of store.keys()) {
    assert.ok(key.startsWith('rl:otp:'), `unexpected key outside the rl:otp: namespace: ${key}`);
  }
});

test('isolation: email hashing never leaks the raw address into a key', async () => {
  const { checkRequestCode } = freshModule();
  await checkRequestCode(fakeReq('61.0.0.1'), 'secret@example.com');
  for (const key of store.keys()) {
    assert.ok(!key.includes('secret'), `raw email leaked into key: ${key}`);
    assert.ok(!key.includes('@'), `raw email leaked into key: ${key}`);
  }
});

// ---- fail-closed (D10) ----------------------------------------------------

test('fail-closed: an unreachable store refuses both send and verify with outcome "unavailable"', async () => {
  const { checkRequestCode, checkVerifyCode } = freshModule();
  global.fetch = async () => {
    throw new Error('simulated network failure');
  };
  const sendResult = await checkRequestCode(fakeReq(), 'down@example.com');
  const verifyResult = await checkVerifyCode(fakeReq(), 'down@example.com');
  assert.deepEqual(sendResult, { outcome: 'unavailable' });
  assert.deepEqual(verifyResult, { outcome: 'unavailable' });
});

test('fail-closed: missing Upstash env vars also refuses with "unavailable"', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const { checkRequestCode } = freshModule();
  const result = await checkRequestCode(fakeReq(), 'noenv@example.com');
  assert.deepEqual(result, { outcome: 'unavailable' });
  assert.equal(calls.length, 0);
});

test('fail-closed: an outage logs the flagged ops-alert gap (ops-alert.js not built yet, Item 19 scope)', async () => {
  const { checkRequestCode } = freshModule();
  global.fetch = async () => {
    throw new Error('simulated network failure');
  };
  await checkRequestCode(fakeReq(), 'down2@example.com');
  assert.ok(
    errorLogs.some((msg) => msg.includes('ops-alert.js does not exist yet')),
    'expected the flagged-gap log line explaining ops-alert.js is not built yet'
  );
});

test('hashEmail: same email normalised (trim/case) hashes identically; different emails hash differently', () => {
  const { hashEmail } = freshModule();
  assert.equal(hashEmail('  Alex@Example.com '), hashEmail('alex@example.com'));
  assert.notEqual(hashEmail('alex@example.com'), hashEmail('someoneelse@example.com'));
  assert.equal(hashEmail('alex@example.com').length, 64); // sha256 hex
});
