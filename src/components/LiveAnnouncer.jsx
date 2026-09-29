// src/components/LiveAnnouncer.jsx — Item 24 Step 7. Design spec §3
// "genuinely new": "polite region + batching. Utility; no existing
// equivalent." §2.5 "Announcement": one polite live region, max one
// sentence per poll — "Ben claimed Teh tarik.", "Ben and 2 others claimed
// items." for several changes at once, and the caller's own actions get
// their own line ("Claimed Teh tarik."). The batching itself (deciding
// WHAT one sentence to say for a given poll's diff) is PayerScreen.jsx's
// job — see its `summarizeChanges` — this component only renders whatever
// single message it is given, politely, and is not triggered by tint alone
// (§4 accessibility checklist).
export default function LiveAnnouncer({ message }) {
  return (
    <div aria-live="polite" role="status" className="sr-only" data-testid="live-announcer">
      {message}
    </div>
  );
}
