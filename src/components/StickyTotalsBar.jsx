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
