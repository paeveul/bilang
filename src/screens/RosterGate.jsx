// src/screens/RosterGate.jsx — Item 24 Step 6: the roster gate
// (`bilang-item-24-roster-gate-and-claim-screens.md` §1). Lives on
// ParsingScreen.jsx, below the scan spinner (§1.1 "while the scan
// processes" — not a new screen, not a new route). Mounted for the whole
// life of the wait, so its own local state (touched/showErrors) can safely
// live in this component rather than BillContext: nothing here needs to
// survive a re-mount, only a re-render.
//
// Renaming happens here while `assignments` is still empty (parsing hasn't
// finished, so ReviewScreen's per-item default-assignment effect hasn't run
// yet) — see bill-reducer.js's RENAME_PAYER header comment for why that
// means index-based renaming needs no propagation into assignment data in
// practice, though the reducer action itself is written to stay correct if
// ever dispatched later too.
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { motion } from 'motion/react';
import PeopleStepper from '../components/PeopleStepper.jsx';
import { useBillActions, useBillState } from '../state/BillContext.jsx';
import { validateRoster } from './roster-validation.js';

const TAP_SCALE = { scale: 0.97 };
const TAP_TRANSITION = { duration: 0.1 };

export default function RosterGate({ scanDone, touched, onTouch, onContinue, showErrors, onShowErrors }) {
  const { payers, claimMode } = useBillState();
  const { addPayer, removePayer, renamePayer, setClaimMode } = useBillActions();

  const solo = payers.length <= 1;
  const validation = validateRoster(payers);

  function touch() {
    if (!touched) onTouch();
  }

  function handlePeopleChange(nextCount) {
    touch();
    const count = Math.max(1, nextCount);
    if (count === payers.length) return;

    if (count > payers.length) {
      // §1.3: crossing from solo to multi blanks the host's own row (it
      // stops meaning "you" on a friend's phone and starts requiring a real
      // name — §1.3's "Your name" rule).
      if (payers.length === 1 && payers[0] === 'Me') renamePayer(0, '');
      for (let n = payers.length + 1; n <= count; n += 1) {
        addPayer(`Person ${n}`);
      }
    } else {
      for (let i = payers.length; i > count; i -= 1) {
        removePayer(payers[i - 1]);
      }
      // Back down to solo: restore the default 'Me' if the host never
      // typed a real name over the blank row (§1.3: "roster name stays
      // 'Me' while people = 1").
      if (count === 1 && (payers[0] === '' || payers[0] === undefined)) {
        renamePayer(0, 'Me');
      }
    }
  }

  function handleContinue() {
    touch();
    if (solo) {
      onContinue();
      return;
    }
    if (!validation.valid) {
      onShowErrors(true);
      return;
    }
    onShowErrors(false);
    onContinue();
  }

  const buttonLabel = !scanDone ? 'Reading your receipt…' : 'Continue';
  const buttonDisabled = !scanDone;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-4 text-left" data-testid="roster-gate">
      <h3 className="font-semibold text-sm text-slate-700">Who's splitting this bill?</h3>

      <div className="space-y-1">
        <span className="block text-xs text-slate-500">How many people, including you?</span>
        <PeopleStepper count={payers.length} onChange={handlePeopleChange} />
        {solo && (
          <p className="text-xs text-slate-400" data-testid="solo-helper">
            Just you for now. Add people if you're sharing this bill.
          </p>
        )}
      </div>

      {!solo && (
        <div className="space-y-2" data-testid="name-rows">
          {payers.map((name, index) => {
            const message = showErrors ? validation.messageFor(index) : null;
            return (
              <div key={index} className="space-y-1">
                <input
                  type="text"
                  value={name}
                  maxLength={20}
                  placeholder={index === 0 ? undefined : `Person ${index + 1}`}
                  onChange={(e) => renamePayer(index, e.target.value)}
                  aria-label={index === 0 ? 'Your name' : `Name for person ${index + 1}`}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? `roster-row-${index}-error` : undefined}
                  className={`w-full min-h-[48px] rounded-md text-sm border ${
                    message ? 'border-amber-600' : 'border-slate-300'
                  }`}
                />
                {message && (
                  <p id={`roster-row-${index}-error`} className="text-xs text-red-700">
                    {message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!solo && (
        <div className="space-y-2" data-testid="claim-mode-toggle">
          <span className="block text-xs text-slate-500">Who picks the items?</span>
          <ToggleGroup.Root
            type="single"
            value={claimMode}
            onValueChange={(next) => {
              touch();
              if (next) setClaimMode(next);
            }}
            className="space-y-2"
          >
            <ToggleGroup.Item value="host" asChild>
              <motion.button
                type="button"
                whileTap={TAP_SCALE}
                transition={TAP_TRANSITION}
                className={`w-full min-h-[48px] text-left rounded-lg border p-3 ${
                  claimMode === 'host' ? 'border-amber-500 bg-amber-50' : 'border-slate-300'
                }`}
              >
                <span className="block text-sm font-medium">I'll assign the items</span>
                <span className="block text-xs text-slate-500">
                  You choose who has what. This is how Bilang works today.
                </span>
              </motion.button>
            </ToggleGroup.Item>
            <ToggleGroup.Item value="payers" asChild>
              <motion.button
                type="button"
                whileTap={TAP_SCALE}
                transition={TAP_TRANSITION}
                className={`w-full min-h-[48px] text-left rounded-lg border p-3 ${
                  claimMode === 'payers' ? 'border-amber-500 bg-amber-50' : 'border-slate-300'
                }`}
              >
                <span className="block text-sm font-medium">Let everyone pick their own</span>
                <span className="block text-xs text-slate-500">
                  Each person opens the link and taps their own items.
                </span>
              </motion.button>
            </ToggleGroup.Item>
          </ToggleGroup.Root>
          {claimMode === 'payers' && (
            <p className="text-xs text-slate-500" role="status" data-testid="claim-mode-note">
              Anything nobody picks shows as 'not yet claimed'. Nobody pays for it until someone claims it.
            </p>
          )}
        </div>
      )}

      {showErrors && !validation.valid && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {validation.summaryMessage}
        </div>
      )}

      <motion.button
        type="button"
        onClick={handleContinue}
        disabled={buttonDisabled}
        whileTap={!buttonDisabled ? TAP_SCALE : undefined}
        transition={TAP_TRANSITION}
        className="w-full min-h-[48px] rounded-lg bg-amber-500 disabled:bg-slate-300 text-white font-semibold py-3"
      >
        {buttonLabel}
      </motion.button>
      {!scanDone && touched && (
        <p className="text-xs text-slate-400 text-center">We'll carry on as soon as the receipt is read.</p>
      )}
    </div>
  );
}
