// src/screens/PayerScreen.jsx — Item 24 Step 7 rebuild of the /s/:id route
// target (`bilang-item-24-roster-gate-and-claim-screens.md` §2). Replaces
// the Item 22 Step 6 read-only build (git history has that version) with
// the full claim UI: identity tap (§2.2), claim/un-claim/shared per item
// (§2.3, via ClaimableItemRow.jsx), live totals (§2.4, computed client-side
// per C9 — "Until [Item 21] Step 4, per-payer figures shown on the payer
// screen come from the client preview", same computeTotals() ReviewScreen
// already uses), live updates (§2.5, usePolledSplit.js), and the loading/
// offline/error states (§2.6).
//
// Read-only fallback (P22, "claiming unavailable"): no roster on the split
// (payers null — an old split, or CLAIMS_ENABLED was off at creation-time
// glue... in practice today CLAIMS_ENABLED gates the PATCH endpoint only,
// so a split can have a roster with claiming still off server-side; the
// first claim attempt then comes back 409 claiming_unavailable and this
// screen falls back the same way) renders the old simple list, unchanged
// in spirit from the Item 22 Step 6 build. THE SECURITY FIX for item.qty
// (payer-item-row.js) is reused there, untouched — see that file's header
// comment and its kept test, payer-item-row.security.test.mjs.
import { useEffect, useRef, useState } from 'react';
import { computeTotals, formatRM, fromCents } from '../../js/totals.js';
import { usePolledSplit } from '../hooks/usePolledSplit.js';
import { PayerItemRow } from './payer-item-row.js';
import ClaimableItemRow from './ClaimableItemRow.jsx';
import { computeRowState, namesList } from './claim-row-state.js';
import StickyTotalsBar from '../components/StickyTotalsBar.jsx';
import LiveAnnouncer from '../components/LiveAnnouncer.jsx';

const CONFLICT_NOTE_MS = 4000;

// Per-split-id identity memory (§2.2: "remembered in the browser for that
// split id"), wrapped so a blocked store (private window, cleared/blocked
// site data) changes nothing — the person is just asked again.
function readStoredIdentity(id) {
  try {
    return window.localStorage.getItem(`bilang:identity:${id}`);
  } catch {
    return null;
  }
}
function writeStoredIdentity(id, name) {
  try {
    window.localStorage.setItem(`bilang:identity:${id}`, name);
  } catch {
    /* blocked store: identity just won't be remembered next visit */
  }
}

export default function PayerScreen({ id }) {
  const { split, status, errorMessage, pollFailCount, resuming, claim, unclaim } = usePolledSplit(id);

  const [me, setMe] = useState(() => readStoredIdentity(id));
  const [claimingIds, setClaimingIds] = useState(() => new Set());
  const [rowNotes, setRowNotes] = useState({}); // itemId -> text, auto-clears after CONFLICT_NOTE_MS
  const [claimingUnavailable, setClaimingUnavailable] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [liveMessage, setLiveMessage] = useState('');
  const [snapTick, setSnapTick] = useState(0);

  const prevAssignmentsRef = useRef(null);
  const prevVersionRef = useRef(-1);
  const ownActionRef = useRef(null); // { itemId, verb: 'claim'|'unclaim', itemName }
  const noteTimersRef = useRef({});

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // §2.5 "Money": every server-authoritative update (a poll landing, a
  // claim response landing) bumps snapTick, so AnimatedMoney snaps instead
  // of gliding (Item 22 M5's discipline, reused, not rebuilt).
  useEffect(() => {
    if (!split) return;
    setSnapTick((n) => n + 1);
  }, [split?.version]); // eslint-disable-line react-hooks/exhaustive-deps -- version is the authoritative change signal

  // §2.5 "Announcement" — one polite sentence per poll (or per own action),
  // diffing the previous assignments against the new ones. Own actions
  // (flagged via ownActionRef, set right before calling claim()/unclaim())
  // get their own line and are never re-announced as someone else's change.
  useEffect(() => {
    if (!split || !split.items) return;
    if (split.version === prevVersionRef.current) return;
    const prevAssignments = prevAssignmentsRef.current;
    const isFirstLoad = prevAssignments === null;
    prevAssignmentsRef.current = split.assignments || {};
    prevVersionRef.current = split.version;

    const own = ownActionRef.current;
    ownActionRef.current = null;
    if (own) {
      setLiveMessage(own.verb === 'claim' ? `Claimed ${own.itemName}.` : `Removed you from ${own.itemName}.`);
      return;
    }
    if (isFirstLoad) return;

    const roster = split.payers || [];
    const changedNames = []; // [{ itemName, addedBy: string[] }]
    for (const item of split.items) {
      const before = computeRowState(item, prevAssignments[item.id], roster, me);
      const after = computeRowState(item, split.assignments[item.id], roster, me);
      const beforeNames = new Set(before.names);
      const addedBy = after.names.filter((n) => !beforeNames.has(n));
      if (addedBy.length > 0) changedNames.push({ itemName: item.name, addedBy });
    }
    if (changedNames.length === 0) return;
    if (changedNames.length === 1) {
      const { itemName, addedBy } = changedNames[0];
      setLiveMessage(`${namesList(addedBy)} claimed ${itemName}.`);
    } else {
      const allNames = [...new Set(changedNames.flatMap((c) => c.addedBy))];
      setLiveMessage(
        allNames.length === 1
          ? `${allNames[0]} claimed items.`
          : `${allNames[0]} and ${allNames.length - 1} others claimed items.`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- driven by split.version, me read fresh each run
  }, [split?.version]);

  function showRowNote(itemId, text) {
    setRowNotes((prev) => ({ ...prev, [itemId]: text }));
    if (noteTimersRef.current[itemId]) clearTimeout(noteTimersRef.current[itemId]);
    noteTimersRef.current[itemId] = setTimeout(() => {
      setRowNotes((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }, CONFLICT_NOTE_MS);
  }

  useEffect(
    () => () => {
      Object.values(noteTimersRef.current).forEach(clearTimeout);
    },
    []
  );

  function chooseIdentity(name) {
    setMe(name);
    writeStoredIdentity(id, name);
  }

  async function handleClaim(itemId, sharedWith) {
    if (!me) return;
    const item = split.items.find((i) => i.id === itemId);
    setClaimingIds((prev) => new Set(prev).add(itemId));
    ownActionRef.current = { itemId, verb: 'claim', itemName: item?.name || 'item' };
    const result = await claim(itemId, me, sharedWith);
    setClaimingIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    if (result.outcome === 'applied') return;

    ownActionRef.current = null; // no local action to announce; handle the outcome explicitly below
    if (result.code === 'already_claimed') {
      // Read the just-applied row straight from the 409 response body
      // (already folded into the hook's state by usePolledSplit.claim()),
      // not from this closure's `split` — which was captured BEFORE the
      // claim attempt and is stale by the time this branch runs.
      const roster = split.payers || [];
      const freshAssignment = result.body?.assignments ? result.body.assignments[itemId] : split.assignments?.[itemId];
      const rowState = computeRowState(item, freshAssignment, roster, me);
      if (rowState.kind === 'host-set' || rowState.kind === 'host-partial') {
        // P12a: nobody tapped it via claim — no note, row just shows "Set by host".
        return;
      }
      const label =
        rowState.names.length <= 1
          ? `${rowState.names[0] || 'Someone'} just claimed this.`
          : `${namesList(rowState.names)} just claimed this.`; // P12b truncation reused
      showRowNote(itemId, label);
      return;
    }
    if (result.code === 'rate_limited') {
      showRowNote(itemId, 'Lots of taps at once. Try again in a moment.');
      return;
    }
    if (result.code === 'claiming_unavailable') {
      setClaimingUnavailable(true);
      return;
    }
    // P23 (403) is silent; anything else (busy/network/400) is P20's fallback.
    if (result.status !== 403) {
      showRowNote(itemId, "That didn't go through. Tap to try again.");
    }
  }

  async function handleUnclaim(itemId) {
    if (!me) return;
    const item = split.items.find((i) => i.id === itemId);
    setClaimingIds((prev) => new Set(prev).add(itemId));
    ownActionRef.current = { itemId, verb: 'unclaim', itemName: item?.name || 'item' };
    const result = await unclaim(itemId, me);
    setClaimingIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    if (result.outcome === 'applied') return;
    ownActionRef.current = null;
    if (result.code === 'not_your_claim') return; // shouldn't reach the UI (no button shown), defensive only
    if (result.code === 'claiming_unavailable') {
      setClaimingUnavailable(true);
      return;
    }
    if (result.status !== 403 && result.code !== 'rate_limited') {
      showRowNote(itemId, "That didn't go through. Tap to try again.");
    } else if (result.code === 'rate_limited') {
      showRowNote(itemId, 'Lots of taps at once. Try again in a moment.');
    }
  }

  if (status === 'loading') {
    return (
      <section data-screen="payer" className="app-screen py-8 space-y-4">
        <h2 className="text-xl font-bold">Pick your items</h2>
        <div className="text-center py-12 space-y-4">
          <div
            role="status"
            aria-label="Loading split"
            className="animate-spin mx-auto h-10 w-10 rounded-full border-4 border-amber-500 border-t-transparent"
          />
          <p className="text-slate-600">Loading split…</p>
        </div>
      </section>
    );
  }

  if (status === 'error' && !split) {
    return (
      <section data-screen="payer" className="app-screen py-8 space-y-4">
        <h2 className="text-xl font-bold">Pick your items</h2>
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {errorMessage || 'This split was not found, or has expired.'}
        </div>
      </section>
    );
  }

  if (!split) return null;

  const hasRoster = Array.isArray(split.payers) && split.payers.length > 0;
  const readOnly = !hasRoster || claimingUnavailable;

  if (readOnly) {
    const payers = Object.keys(split.totals?.per_person || {});
    return (
      <section data-screen="payer" className="app-screen py-8 space-y-4">
        <h2 className="text-xl font-bold">Bill split</h2>
        {!hasRoster ? null : (
          <p className="text-sm text-slate-600" role="status">
            This bill can't be picked from. You can still see what everyone owes.
          </p>
        )}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="font-semibold text-sm text-slate-700">Items</h3>
            <div className="space-y-1">
              {split.items.map((item) => (
                <PayerItemRow key={item.id ?? item.name} item={item} />
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="font-semibold text-sm text-slate-700">Who owes what</h3>
            <div className="text-sm space-y-2">
              {payers.map((name) => (
                <div key={name} className="flex justify-between">
                  <span>{name}</span>
                  <span className="font-semibold">{formatRM(split.totals.per_person[name])}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <h3 className="font-semibold text-sm text-slate-700">Pay the bill owner</h3>
            <p className="text-sm font-mono bg-slate-50 rounded-md p-3 break-words">{split.ownerPaymentHandle}</p>
          </div>
          <p className="text-xs text-slate-400 text-center">
            Split created via Bilang, a free tool by Paeveul. Paeveul never holds or routes this money.
          </p>
        </div>
      </section>
    );
  }

  // C9 / design spec §2.4: figures come from the client preview, computed
  // the same way ReviewScreen's Running totals are — not from a server
  // recompute-on-claim, which is Item 21 Step 4's scope, not this item's.
  const { perPerson, unclaimed } = computeTotals(split.items, split.assignments || {}, split.totals, split.payers);
  const unclaimedCount = split.items.filter(
    (item) => computeRowState(item, split.assignments?.[item.id], split.payers, me).kind === 'unclaimed'
  ).length;
  const allClaimed = unclaimedCount === 0;
  const myTotals = me ? perPerson[me] : null;
  const roster = split.payers;

  return (
    <section data-screen="payer" className="app-screen pb-28 space-y-4">
      <LiveAnnouncer message={liveMessage} />
      <h2 className="text-xl font-bold">Pick your items</h2>

      {me && (
        <div className="sticky top-0 z-10 bg-slate-50 -mx-4 px-4 py-2 flex justify-between items-center text-sm">
          <span>
            You're <strong>{me}</strong>
          </span>
          <button type="button" onClick={() => setMe(null)} className="text-slate-500 underline min-h-[48px] px-1">
            Not you? Change
          </button>
        </div>
      )}

      {!me && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <h3 className="font-semibold text-sm">Who are you?</h3>
          <p className="text-xs text-slate-500">Tap your name so we know which items are yours.</p>
          <ul className="space-y-1">
            {roster.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => chooseIdentity(name)}
                  className="w-full min-h-[48px] text-left rounded-lg border border-slate-300 px-3"
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-500" role="status">
        {allClaimed ? 'Everything is claimed.' : `${unclaimedCount} of ${split.items.length} items not yet claimed`}
      </p>

      {pollFailCount >= 2 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3" role="status">
          Can't refresh right now. Showing the last update.
        </div>
      )}
      {!online && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3" role="status">
          You're offline. Claiming works again when you're back.
        </div>
      )}
      {resuming && status === 'ready' && (
        <p className="text-xs text-slate-400" role="status">
          Updating…
        </p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        {split.items.map((item) => (
          <ClaimableItemRow
            key={item.id}
            item={item}
            assignment={split.assignments?.[item.id]}
            roster={roster}
            me={online ? me : null}
            claiming={claimingIds.has(item.id)}
            conflictNote={rowNotes[item.id] || null}
            onClaim={handleClaim}
            onUnclaim={handleUnclaim}
            snapTick={snapTick}
          />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <h3 className="font-semibold text-sm text-slate-700">Who owes what</h3>
        <div className="text-sm space-y-2">
          {roster.map((name) => (
            <div key={name} className="flex justify-between">
              <span>{name}</span>
              <span className="font-semibold">{formatRM(fromCents(perPerson[name]?.totalCents ?? 0))}</span>
            </div>
          ))}
          {unclaimed.totalCents > 0 && (
            <>
              <div className="flex justify-between text-slate-500 pt-1 border-t border-slate-100">
                <span>Not yet claimed</span>
                <span>{formatRM(fromCents(unclaimed.totalCents))}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Bill total</span>
                <span>{formatRM(split.totals?.grand_total ?? 0)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <h3 className="font-semibold text-sm text-slate-700">Pay the bill owner</h3>
        <p className="text-sm font-mono bg-slate-50 rounded-md p-3 break-words">{split.ownerPaymentHandle}</p>
      </div>

      <p className="text-xs text-slate-400 text-center">
        Split created via Bilang, a free tool by Paeveul. Paeveul never holds or routes this money.
      </p>

      <StickyTotalsBar
        meName={me}
        yourTotalCents={myTotals ? Math.round(myTotals.totalCents) : 0}
        allClaimed={allClaimed}
        unclaimedCents={unclaimed.totalCents}
        unclaimedCount={unclaimedCount}
        snapTick={snapTick}
      />
    </section>
  );
}
