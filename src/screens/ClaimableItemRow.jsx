// src/screens/ClaimableItemRow.jsx — Item 24 Step 7: the interactive payer
// claim row, design spec §2.3's state table (P4-P11a) plus the conflict
// notes (P12/P12a/P12b, §7 addendum). Presentation only — every state's
// classification comes from claim-row-state.js's pure computeRowState();
// this component turns that into markup, actions and motion.
//
// motion.dev "payer live claim updates" (design spec §2.5's table, Item 22
// Step 9 placement 4): action buttons fade out when a row becomes claimed
// by someone else, the conflict note fades in/out, the "Yours" badge fades
// in — all via AnimatePresence, under 250ms, ease-out, no bounce. Inherits
// reduced-motion for free from App.jsx's <MotionConfig reducedMotion="user">.
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { computeRowState, namesList } from './claim-row-state.js';
import { formatRM } from '../../js/totals.js';
import StatusBadge from '../components/StatusBadge.jsx';
import AnimatedMoney from '../components/AnimatedMoney.jsx';

const TAP_SCALE = { scale: 0.97 };
const TAP_TRANSITION = { duration: 0.1 };
const FADE = { duration: 0.25, ease: 'easeOut' };

export default function ClaimableItemRow({
  item,
  assignment,
  roster,
  me,
  claiming,
  conflictNote,
  onClaim,
  onUnclaim,
  snapTick,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTicked, setPickerTicked] = useState(() => new Set(me ? [me] : []));

  const rowState = computeRowState(item, assignment, roster, me);
  const { kind } = rowState;

  function openPicker() {
    setPickerTicked(new Set(me ? [me] : []));
    setPickerOpen(true);
  }

  function togglePickerName(name) {
    if (name === me) return; // "your own name is ticked and locked" (§2.3)
    setPickerTicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function confirmShared() {
    const sharedWith = [...pickerTicked].filter((n) => n !== me);
    setPickerOpen(false);
    await onClaim(item.id, sharedWith);
  }

  const statusText = statusTextFor(rowState, item, me);
  const canPickAtLeastOneMore = [...pickerTicked].some((n) => n !== me);

  return (
    <motion.div layout className="py-2 border-b border-slate-100 last:border-0" data-item-id={item.id}>
      <div className="flex justify-between items-start gap-2">
        <span className="flex-1 text-sm font-medium">{item.name}</span>
        <span className="text-sm font-semibold tabular-nums">{formatRM(item.line_total)}</span>
      </div>

      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-xs text-slate-500 flex-1">{statusText}</span>
        <AnimatePresence>
          {kind === 'mine-alone' || kind === 'mine-shared' ? (
            <motion.span
              key="yours"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FADE}
            >
              <StatusBadge>Yours</StatusBadge>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      {kind === 'mine-shared' && rowState.shareCents != null && (
        <p className="text-xs text-slate-500">
          Your share <AnimatedMoney cents={rowState.shareCents} snapTick={snapTick} locked />
        </p>
      )}

      {kind === 'host-partial' && rowState.amounts && (
        <ul className="text-xs text-slate-500 mt-1 space-y-0.5">
          {rowState.names.map((name) => (
            <li key={name}>
              {name}: {formatRM((rowState.amounts[name] || 0) / 100)}
            </li>
          ))}
        </ul>
      )}

      <AnimatePresence>
        {conflictNote && (
          <motion.p
            key="conflict"
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="text-xs text-slate-500 mt-1"
          >
            {conflictNote}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!pickerOpen && kind === 'unclaimed' && me && (
          <motion.div
            key="actions"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="flex gap-2 mt-2"
          >
            <motion.button
              type="button"
              whileTap={!claiming ? TAP_SCALE : undefined}
              transition={TAP_TRANSITION}
              disabled={claiming}
              onClick={() => onClaim(item.id)}
              aria-label={`Claim ${item.name}`}
              className="flex-1 min-h-[48px] rounded-lg bg-amber-500 disabled:bg-slate-300 text-white text-sm font-semibold"
            >
              {claiming ? 'Claiming…' : "That's mine"}
            </motion.button>
            <motion.button
              type="button"
              whileTap={!claiming ? TAP_SCALE : undefined}
              transition={TAP_TRANSITION}
              disabled={claiming}
              onClick={openPicker}
              aria-label={`Share ${item.name} with others`}
              className="flex-1 min-h-[48px] rounded-lg border border-slate-300 disabled:opacity-50 text-sm font-medium"
            >
              Shared
            </motion.button>
          </motion.div>
        )}

        {!pickerOpen && (kind === 'mine-alone' || kind === 'mine-shared') && (
          <motion.div
            key="remove"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="mt-2"
          >
            <motion.button
              type="button"
              whileTap={!claiming ? TAP_SCALE : undefined}
              transition={TAP_TRANSITION}
              disabled={claiming}
              onClick={() => onUnclaim(item.id)}
              aria-label={`Remove me from ${item.name}`}
              className="text-sm text-red-600 underline min-h-[48px]"
            >
              Remove me
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {pickerOpen && (
        <div className="mt-2 space-y-2" data-testid={`picker-${item.id}`}>
          <p className="text-xs text-slate-600">Share this with:</p>
          <ul className="space-y-1">
            {roster.map((name) => {
              const locked = name === me;
              const ticked = pickerTicked.has(name);
              return (
                <li key={name}>
                  <label className="flex items-center gap-2 min-h-[48px]">
                    <input
                      type="checkbox"
                      checked={ticked}
                      disabled={locked}
                      onChange={() => togglePickerName(name)}
                      className="h-5 w-5"
                    />
                    <span>
                      {name}
                      {locked ? ' (You)' : ''}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {!canPickAtLeastOneMore && <p className="text-xs text-slate-500">Pick at least one more person.</p>}
          <div className="flex gap-2">
            <motion.button
              type="button"
              whileTap={canPickAtLeastOneMore ? TAP_SCALE : undefined}
              transition={TAP_TRANSITION}
              disabled={!canPickAtLeastOneMore}
              onClick={confirmShared}
              className="flex-1 min-h-[48px] rounded-lg bg-amber-500 disabled:bg-slate-300 text-white text-sm font-semibold"
            >
              Confirm shared
            </motion.button>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="flex-1 min-h-[48px] rounded-lg border border-slate-300 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function statusTextFor(rowState, item, me) {
  switch (rowState.kind) {
    case 'unclaimed':
      return 'Not yet claimed';
    case 'mine-alone':
      return 'Yours';
    case 'mine-shared': {
      const others = rowState.names.filter((n) => n !== me);
      return `Shared with ${namesList(others)}`;
    }
    case 'other-alone':
      return `${rowState.names[0]} has this`;
    case 'other-shared':
      return `Shared by ${namesList(rowState.names)}`;
    case 'host-set':
      return rowState.names.length === 0 ? 'Set by host' : `Set by host: ${namesList(rowState.names)}`;
    case 'host-partial':
      return `Set by host: ${namesList(rowState.names)}`;
    default:
      return '';
  }
}
