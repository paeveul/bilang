// api/_lib/cookies.test.mjs — Item 10 Checkpoint 1, Step 4.
//
// Exercises readCookie/serializeCookie against a fake request object and a
// fake response header array — no real HTTP involved.
//
// Run: node --test api/_lib/cookies.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readCookie, serializeCookie } = require('./cookies.js');

test('readCookie: finds a single cookie by name', () => {
  const req = { headers: { cookie: 'bilang_at=abc123' } };
  assert.equal(readCookie(req, 'bilang_at'), 'abc123');
});

test('readCookie: finds the right cookie among several, regardless of position', () => {
  const req = {
    headers: { cookie: 'bilang_at=token1; bilang_rt=token2; bilang_sa=anchor3' },
  };
  assert.equal(readCookie(req, 'bilang_rt'), 'token2');
  assert.equal(readCookie(req, 'bilang_sa'), 'anchor3');
  assert.equal(readCookie(req, 'bilang_at'), 'token1');
});

test('readCookie: decodes percent-encoded values', () => {
  const req = { headers: { cookie: 'name=hello%20world%3D%3D' } };
  assert.equal(readCookie(req, 'name'), 'hello world==');
});

test('readCookie: returns the raw value if percent-decoding fails', () => {
  const req = { headers: { cookie: 'name=%E0%A4%A' } }; // truncated escape
  assert.equal(readCookie(req, 'name'), '%E0%A4%A');
});

test('readCookie: returns null when the named cookie is absent', () => {
  const req = { headers: { cookie: 'other=1' } };
  assert.equal(readCookie(req, 'bilang_at'), null);
});

test('readCookie: returns null when there is no Cookie header at all', () => {
  assert.equal(readCookie({ headers: {} }, 'bilang_at'), null);
  assert.equal(readCookie({}, 'bilang_at'), null);
  assert.equal(readCookie(null, 'bilang_at'), null);
});

test('readCookie: tolerates extra whitespace around pairs', () => {
  const req = { headers: { cookie: '  bilang_at=abc  ;   bilang_rt=def  ' } };
  assert.equal(readCookie(req, 'bilang_at'), 'abc');
  assert.equal(readCookie(req, 'bilang_rt'), 'def');
});

test('serializeCookie: sets a positive Max-Age and the required security flags', () => {
  const header = serializeCookie('bilang_at', 'abc123', 3600);
  assert.match(header, /^bilang_at=abc123/);
  assert.match(header, /Max-Age=3600/);
  assert.match(header, /Path=\//);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  // Must never carry an Expires date for a normal (non-clearing) cookie.
  assert.doesNotMatch(header, /Expires=/);
});

test('serializeCookie: percent-encodes the value', () => {
  const header = serializeCookie('name', 'hello world==', 60);
  assert.match(header, /^name=hello%20world%3D%3D/);
});

test('serializeCookie: floors a fractional Max-Age', () => {
  const header = serializeCookie('x', 'y', 59.9);
  assert.match(header, /Max-Age=59(?!\d)/);
});

test('serializeCookie: maxAgeSeconds=0 expires the cookie immediately', () => {
  const header = serializeCookie('bilang_at', '', 0);
  assert.match(header, /Max-Age=0/);
  assert.match(header, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
});

test('serializeCookie: a negative or non-numeric Max-Age is omitted, not miscoded', () => {
  const negative = serializeCookie('x', 'y', -5);
  assert.doesNotMatch(negative, /Max-Age=/);

  const notANumber = serializeCookie('x', 'y', undefined);
  assert.doesNotMatch(notANumber, /Max-Age=/);
});

test('round trip: a fake response header array accepts the serialized cookie, and a fake request reads it back', () => {
  // Simulates how a real handler would use both functions together: push
  // Set-Cookie headers onto a response, then simulate the browser sending
  // one of them back on the next request.
  const responseHeaders = [];
  responseHeaders.push(serializeCookie('bilang_at', 'sess-token-1', 3600));
  responseHeaders.push(serializeCookie('bilang_rt', 'refresh-token-1', 2592000));
  responseHeaders.push(serializeCookie('bilang_sa', 'anchor-xyz', 7776000));

  assert.equal(responseHeaders.length, 3);

  // Simulate the browser echoing the cookies back as a single Cookie header
  // (name=value pairs only — flags like HttpOnly/Secure are never sent back).
  const cookieHeaderValue = responseHeaders
    .map((setCookie) => setCookie.split(';')[0])
    .join('; ');
  const nextReq = { headers: { cookie: cookieHeaderValue } };

  assert.equal(readCookie(nextReq, 'bilang_at'), 'sess-token-1');
  assert.equal(readCookie(nextReq, 'bilang_rt'), 'refresh-token-1');
  assert.equal(readCookie(nextReq, 'bilang_sa'), 'anchor-xyz');
});
