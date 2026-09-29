// src/components/StickyTotalsBar.jsx — Item 24 Step 7. Design spec §2.1
// row 7 / §2.4 / §3 "genuinely new": "No sticky bottom bar exists yet."
// Shows "Your total" (or "Your total so far" while anything is unclaimed)
// plus the "Not yet claimed" figure, hidden at zero (§2.4, P14). Bar shown
// before an identity is chosen carries only the not-yet-claimed figure
// (§2.4 "Bar before identity chosen").
import AnimatedMoney from './AnimatedMoney.jsx';

export default function StickyTotalsBar({ meName, yourTotalCents, allClaimed, unclaimedCents, unclaimedCount, snapTick }) {
  const showUnclaimed = unclaimedCents > 0;
  return (
    <div
      className="sticky bottom-0 z-10 bg-white border-t border-slate-200 px-4 py-3 space-y-1"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      data-testid="sticky-totals-bar"
    >
      {meName && (
        <div className="flex justify-between items-baseline text-sm">
          <span className="text-slate-600">{allClaimed ? 'Your total' : 'Your total so far'}</span>
          <span className="font-bold text-lg" aria-label={`${allClaimed ? 'Your total' : 'Your total so far'}, ${formatAria(yourTotalCents)}`}>
            <AnimatedMoney cents={yourTotalCents} snapTick={snapTick} />
          </span>
        </div>
      )}
      {showUnclaimed && (
        <div
          className="flex justify-between items-baseline text-xs text-slate-500"
          aria-label={`Not yet claimed ${formatAria(unclaimedCents)}, ${unclaimedCount} ${unclaimedCount === 1 ? 'item' : 'items'}`}
        >
          <span>Not yet claimed</span>
          <span>
            <AnimatedMoney cents={unclaimedCents} snapTick={snapTick} locked /> · {unclaimedCount}{' '}
            {unclaimedCount === 1 ? 'item' : 'items'}
          </span>
        </div>
      )}
    </div>
  );
}

function formatAria(cents) {
  return `RM${(Math.round(cents) / 100).toFixed(2)}`;
}
