// src/auth/auth-flow.test.mjs — Item 10 Checkpoint 4: pure helpers behind the
// sign-in screen. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEND_COOLDOWN_SECONDS,
  NETWORK_FALLBACK_MESSAGE,
  normaliseCode,
  termsVersionFrom,
  serverMessage,
} from './auth-flow.js';
import { AuthError } from '../../js/auth-client.js';

test('resend cooldown is 60 seconds, matching the server per-address send window (§10.3)', () => {
  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
});

test('normaliseCode strips whitespace so a pasted "123 456" reaches the server as six digits', () => {
  assert.equal(normaliseCode('123 456'), '123456');
  assert.equal(normaliseCode(' 123456\n'), '123456');
  // Anything else passes through untouched; the server answers with its own 400 text.
  assert.equal(normaliseCode('12a'), '12a');
  assert.equal(normaliseCode(undefined), '');
});

test('termsVersionFrom reads VITE_TERMS_VERSION and never invents a default', () => {
  assert.equal(termsVersionFrom(undefined), undefined, 'no env object means no version');
  assert.equal(termsVersionFrom({}), undefined, 'unset means no version');
  assert.equal(termsVersionFrom({ VITE_TERMS_VERSION: '   ' }), undefined, 'blank means no version');
  assert.equal(termsVersionFrom({ VITE_TERMS_VERSION: ' 2026-10-01 ' }), '2026-10-01');
});

test('serverMessage shows the server error text verbatim', () => {
  const err = new AuthError(503, 'auth_unavailable', {
    error: 'Sign-in is temporarily unavailable. Please try again shortly.',
    code: 'auth_unavailable',
  });
  assert.equal(serverMessage(err), 'Sign-in is temporarily unavailable. Please try again shortly.');
});

test('serverMessage falls back only when there is no server text (request never answered)', () => {
  assert.equal(serverMessage(new TypeError('Failed to fetch')), NETWORK_FALLBACK_MESSAGE);
  assert.equal(serverMessage(new AuthError(500, null, null)), NETWORK_FALLBACK_MESSAGE);
});
