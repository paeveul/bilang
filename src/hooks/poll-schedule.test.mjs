// src/hooks/poll-schedule.test.mjs — Item 24 Step 7.
// Run: node --test src/hooks/poll-schedule.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pollIntervalMs,
  jitter,
  isStaleVersion,
  FAST_INTERVAL_MS,
  MEDIUM_INTERVAL_MS,
  SLOW_INTERVAL_MS,
  FAST_WINDOW_MS,
  MEDIUM_WINDOW_MS,
  JITTER_RATIO,
} from './poll-schedule.js';

test('fast phase: within 3 minutes of opening, no claims yet', () => {
  const opened = 0;
  assert.equal(pollIntervalMs(0, opened, opened), FAST_INTERVAL_MS);
  assert.equal(pollIntervalMs(FAST_WINDOW_MS - 1, opened, opened), FAST_INTERVAL_MS);
});

test('medium phase: 3-10 quiet minutes since open, no claims', () => {
  const opened = 0;
  assert.equal(pollIntervalMs(FAST_WINDOW_MS, opened, opened), MEDIUM_INTERVAL_MS);
  assert.equal(pollIntervalMs(MEDIUM_WINDOW_MS - 1, opened, opened), MEDIUM_INTERVAL_MS);
});

test('slow phase: 10+ quiet minutes since open, no claims', () => {
  const opened = 0;
  assert.equal(pollIntervalMs(MEDIUM_WINDOW_MS, opened, opened), SLOW_INTERVAL_MS);
  assert.equal(pollIntervalMs(MEDIUM_WINDOW_MS + 60_000, opened, opened), SLOW_INTERVAL_MS);
});

test('a claim landing resets the fast phase, even long after the tab opened', () => {
  const opened = 0;
  const longAfterOpen = MEDIUM_WINDOW_MS + 60_000;
  // Without a claim, this moment would be slow.
  assert.equal(pollIntervalMs(longAfterOpen, opened, opened), SLOW_INTERVAL_MS);
  // A claim landing right before this moment resets to fast for everyone
  // viewing the bill (lastActivityAtMs bumped to just before `now`).
  const claimAt = longAfterOpen - 1000;
  assert.equal(pollIntervalMs(longAfterOpen, opened, claimAt), FAST_INTERVAL_MS);
});

test('"whichever is later" — a stale tab-open time never overrides a recent claim, and vice versa', () => {
  // Tab opened long ago, but a claim just landed: still fast.
  assert.equal(pollIntervalMs(10_000_000, 0, 10_000_000 - 500), FAST_INTERVAL_MS);
  // Tab just opened, no claims yet (lastActivityAtMs === openedAtMs): fast.
  assert.equal(pollIntervalMs(0, 0, 0), FAST_INTERVAL_MS);
});

test('jitter stays within +/-15% of the base and is deterministic given a fixed random source', () => {
  const base = 2000;
  const lo = jitter(base, () => 0);
  const hi = jitter(base, () => 1);
  assert.equal(lo, base * (1 - JITTER_RATIO));
  assert.equal(hi, base * (1 + JITTER_RATIO));
  const mid = jitter(base, () => 0.5);
  assert.equal(mid, base);
});

test('isStaleVersion — strictly lower is stale, equal or higher is not', () => {
  assert.equal(isStaleVersion(5, 4), true);
  assert.equal(isStaleVersion(5, 5), false);
  assert.equal(isStaleVersion(5, 6), false);
});
