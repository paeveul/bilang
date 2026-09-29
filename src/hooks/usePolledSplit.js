// src/hooks/usePolledSplit.js — Item 24 Step 7 (§24.3's "Payer-side"
// paragraph, cross-referenced by design spec §7's addendum): the poll loop
// behind PayerScreen.jsx. Owns:
//   - the decaying poll schedule (src/hooks/poll-schedule.js, pure —
//     unit-tested there; this file wires it to real timers/effects),
//   - the hidden-tab pause (document.visibilitychange — stop while hidden,
//     fetch at once and resume on return, §2.5 "on return, fetch at once
//     and show 'Updating…' until it lands"),
//   - the stale-version discard (C12 — a response whose version is lower
//     than the one already shown is ignored outright),
//   - start()/stop(), exposed so Item 21 Phase B can take the loop over
//     later (run the poll only while the realtime socket is down) without
//     rewriting this screen — see §24.3's own note. Not built here.
//
// Also exposes claim/unclaim, which call js/api-client.js's patchSplit()
// and fold a successful, a 409-already_claimed, or a 200-unchanged response
// straight into the same local state the poll loop updates — a claim
// response already carries the freshest assignments/totals/version, so
// there's no need to wait for the next poll tick to see your own action
// (or someone else's winning one) reflected.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSplit, patchSplit, PatchSplitError } from '../../js/api-client.js';
import { isStaleVersion, jitter, pollIntervalMs } from './poll-schedule.js';

export function usePolledSplit(id) {
  const [split, setSplit] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [pollFailCount, setPollFailCount] = useState(0);
  const [resuming, setResuming] = useState(false);

  const versionRef = useRef(-1);
  const splitRef = useRef(null);
  const timerRef = useRef(null);
  const runningRef = useRef(false);
  const idRef = useRef(id);
  idRef.current = id;

  const openedAtRef = useRef(Date.now());
  const lastActivityAtRef = useRef(openedAtRef.current);

  // Applies a fetched/patched row if its version is not stale. Returns
  // whether the version actually advanced (a real change, as opposed to a
  // no-op re-poll or a repeat-tap 200) — the caller uses this to decide
  // whether to reset the poll schedule's fast phase (§24.3: "any claim
  // landing on the bill resets ... to the fast phase").
  const applyRow = useCallback((data) => {
    const nextVersion = typeof data.version === 'number' ? data.version : 0;
    if (isStaleVersion(versionRef.current === -1 ? -Infinity : versionRef.current, nextVersion)) {
      return false;
    }
    const advanced = versionRef.current !== -1 && nextVersion > versionRef.current;
    versionRef.current = nextVersion;
    const merged = { ...(splitRef.current || {}), ...data };
    splitRef.current = merged;
    setSplit(merged);
    setStatus('ready');
    setPollFailCount(0);
    return advanced;
  }, []);

  const poll = useCallback(async () => {
    try {
      const data = await getSplit(idRef.current);
      const advanced = applyRow(data);
      if (advanced) lastActivityAtRef.current = Date.now();
    } catch (err) {
      setPollFailCount((n) => n + 1);
      setStatus((prev) => (prev === 'ready' ? prev : 'error'));
      setErrorMessage(err.message || 'This split was not found, or has expired.');
    }
  }, [applyRow]);

  const scheduleNext = useCallback(() => {
    if (!runningRef.current) return;
    const base = pollIntervalMs(Date.now(), openedAtRef.current, lastActivityAtRef.current);
    timerRef.current = setTimeout(async () => {
      if (!runningRef.current) return;
      await poll();
      scheduleNext();
    }, jitter(base));
  }, [poll]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(
    (immediate = false) => {
      if (runningRef.current) return;
      runningRef.current = true;
      if (immediate) {
        setResuming(true);
        poll()
          .then(() => setResuming(false))
          .then(scheduleNext);
      } else {
        scheduleNext();
      }
    },
    [poll, scheduleNext]
  );

  const refresh = useCallback(async () => {
    await poll();
  }, [poll]);

  useEffect(() => {
    // Fresh id: reset everything and fetch immediately (§2.6 "First load").
    versionRef.current = -1;
    splitRef.current = null;
    openedAtRef.current = Date.now();
    lastActivityAtRef.current = openedAtRef.current;
    setSplit(null);
    setStatus('loading');
    setPollFailCount(0);
    stop();
    start(true); // first load: fetch immediately, then settle into the schedule

    function handleVisibility() {
      if (document.hidden) {
        stop();
      } else {
        stop();
        start(true); // "on return, fetch at once" (§2.5)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs only on id change, by design
  }, [id]);

  const claim = useCallback(
    async (itemId, payer, sharedWith) => {
      const body = { action: 'claim', itemId, payer, ...(sharedWith ? { sharedWith } : {}) };
      try {
        const data = await patchSplit(idRef.current, body);
        const advanced = applyRow(data);
        if (advanced) lastActivityAtRef.current = Date.now();
        return { outcome: 'applied' };
      } catch (err) {
        if (err instanceof PatchSplitError && err.body && typeof err.body.version === 'number') {
          applyRow(err.body); // 409 already_claimed still carries the current row (§24.3)
        }
        return errOutcome(err);
      }
    },
    [applyRow]
  );

  const unclaim = useCallback(
    async (itemId, payer) => {
      const body = { action: 'unclaim', itemId, payer };
      try {
        const data = await patchSplit(idRef.current, body);
        const advanced = applyRow(data);
        if (advanced) lastActivityAtRef.current = Date.now();
        return { outcome: 'applied' };
      } catch (err) {
        return errOutcome(err);
      }
    },
    [applyRow]
  );

  return { split, status, errorMessage, pollFailCount, resuming, start, stop, refresh, claim, unclaim };
}

function errOutcome(err) {
  if (err instanceof PatchSplitError) {
    return { outcome: 'error', status: err.status, code: err.code, message: err.message, body: err.body };
  }
  return { outcome: 'error', status: 0, code: 'network', message: err.message || 'Network error', body: null };
}
