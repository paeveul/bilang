// src/hooks/poll-schedule.js — Item 24, the decaying poll schedule decided
// 2026-09-29 (Jenny + Howard, approved by Alex; bilang-mvp1-implementation-
// plans.md §24.3's usePolledSplit paragraph, cross-referenced by the design
// spec's §7 addendum as "not a design change" — nothing a payer sees or
// does changes, only how often the client refreshes in the background).
//
// Pulled out of usePolledSplit.js as a pure, dependency-free module (same
// reason js/totals.js's arithmetic and review-validation.js's rules are
// pure modules of their own) so the schedule math is unit-testable without
// fake timers, DOM, or React at all.
//
// Rule: ~2s for the first 3 minutes after the tab opened, OR the first 3
// minutes after the last claim landed on the bill, WHICHEVER IS LATER; ~6s
// after 3 quiet minutes; ~12s after 10 quiet minutes. "Quiet" is measured
// from the more recent of (tab opened, last claim seen) — a claim landing
// resets every viewer of the bill back to the fast phase, because it
// bumps `lastActivityAtMs` the same way opening the tab did.

export const FAST_INTERVAL_MS = 2000;
export const MEDIUM_INTERVAL_MS = 6000;
export const SLOW_INTERVAL_MS = 12000;

export const FAST_WINDOW_MS = 3 * 60 * 1000;
export const MEDIUM_WINDOW_MS = 10 * 60 * 1000;

// +/-15% jitter, matching Item 24 C12's "poll every 1.5-2s (jittered)" —
// applied uniformly across all three phases, not just the fast one.
export const JITTER_RATIO = 0.15;

/**
 * The base interval (before jitter) for the given moment, per the decaying
 * schedule above.
 *
 * @param {number} nowMs
 * @param {number} openedAtMs - when this viewer's poll loop started
 * @param {number} lastActivityAtMs - when a claim was last observed to land
 *   on this bill (initialised to openedAtMs — opening the tab counts as the
 *   start of the fast phase even with no claims yet)
 */
export function pollIntervalMs(nowMs, openedAtMs, lastActivityAtMs) {
  const quietForMs = nowMs - Math.max(openedAtMs, lastActivityAtMs);
  if (quietForMs < FAST_WINDOW_MS) return FAST_INTERVAL_MS;
  if (quietForMs < MEDIUM_WINDOW_MS) return MEDIUM_INTERVAL_MS;
  return SLOW_INTERVAL_MS;
}

/**
 * Applies +/-JITTER_RATIO jitter to a base interval. `random` is injectable
 * (defaults to Math.random) so tests can assert exact bounds deterministically.
 */
export function jitter(baseMs, random = Math.random) {
  const delta = baseMs * JITTER_RATIO;
  return baseMs - delta + random() * delta * 2;
}

/**
 * Item 24 C12 — out-of-order protection: a response carrying a version
 * lower than the one already shown must be ignored outright. Equal versions
 * are not stale (a repeat/no-op response, e.g. a retried claim, still needs
 * to land so failCount resets etc.) — only strictly lower is discarded.
 */
export function isStaleVersion(shownVersion, incomingVersion) {
  return incomingVersion < shownVersion;
}
