//
// The roster step shown while the receipt is being read. The editing body
// (stepper, name rows, who-picks toggle) is RosterEditor, shared with the
// Review "People" panel. Renaming happens while `assignments` is still empty
// (parsing hasn't finished), so no assignment data is touched in practice.
import { motion } from 'motion/react';
import { useBillState } from '../state/BillContext.jsx';
import RosterEditor from './RosterEditor.jsx';
import { validateRoster } from './roster-validation.js';

const TAP_SCALE = { scale: 0.97 };
const TAP_TRANSITION = { duration: 0.1 };

export default function RosterGate({ scanDone, touched, onTouch, onContinue, showErrors, onShowErrors }) {
  const { payers } = useBillState();

  const solo = payers.length <= 1;
  const validation = validateRoster(payers);

  function touch() {
    if (!touched) onTouch();
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

      <RosterEditor showErrors={showErrors} onTouch={touch} />

      <motion.button
        type="button"
        onClick={handleContinue}
        disabled={buttonDisabled}
        whileTap={!buttonDisabled ? TAP_SCALE : undefined}
        transition={TAP_TRANSITION}
        className="w-full min-h-[48px] rounded-lg bg-amber-500 disabled:bg-slate-300 text-slate-900 disabled:text-slate-700 font-semibold py-3"
      >
        {buttonLabel}
      </motion.button>
      {!scanDone && touched && (
        <p className="text-sm text-slate-600 text-center">We'll carry on as soon as the receipt is read.</p>
      )}
    </div>
  );
}
