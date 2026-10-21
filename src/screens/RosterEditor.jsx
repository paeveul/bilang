// The people editor: stepper, name rows and the "who picks the items" choice.
// Used by the scan-wait roster step (RosterGate) and the Review "People"
// panel (ReviewPeopleRow), so the two cannot drift apart.
import { useEffect, useRef, useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { motion } from 'motion/react';
import PeopleStepper from '../components/PeopleStepper.jsx';
import { useBillActions, useBillState } from '../state/BillContext.jsx';
import {
  assignmentKeys,
  countUnallocatedItems,
  hasHandAssignedItems,
  isDefaultAssignment,
} from '../state/bill-reducer.js';
import { nextPersonLabel, stripHiddenChars, validateRoster } from './roster-validation.js';

const TAP_SCALE = { scale: 0.97 };
const TAP_TRANSITION = { duration: 0.1 };

function optionClass(selected) {
  return `w-full min-h-[48px] text-left rounded-lg border p-3 ${
    selected ? 'border-amber-600 bg-amber-50' : 'border-slate-300'
  }`;
}

export default function RosterEditor({ showErrors, onTouch, showChangeNotes = false }) {
  const state = useBillState();
  const { payers, claimMode, parsed, assignments } = state;
  const { addPayer, removePayer, renamePayer, setClaimMode } = useBillActions();

  const solo = payers.length <= 1;
  const validation = validateRoster(payers);
  const rootRef = useRef(null);
  const promptRef = useRef(null);
  const [pendingSwitch, setPendingSwitch] = useState(false);
  const [note, setNote] = useState('');
  // A shared name is flagged once the host leaves a box or taps the stepper,
  // never on every keystroke. It clears itself as soon as the clash is gone.
  const [clashRevealed, setClashRevealed] = useState(false);
  const confirmVisible = pendingSwitch && !solo && claimMode === 'host';

  useEffect(() => {
    if (confirmVisible) promptRef.current?.focus();
  }, [confirmVisible]);

  useEffect(() => {
    if (validation.duplicateIndices.length === 0 && clashRevealed) setClashRevealed(false);
  }, [validation.duplicateIndices.length, clashRevealed]);

  function touch() {
    if (onTouch) onTouch();
  }

  function handleNameBlur(index, value) {
    // Hidden characters (zero-width, control) are removed on leaving the box;
    // everything else the host typed is left exactly as it is.
    const stripped = stripHiddenChars(value);
    if (stripped !== value) renamePayer(index, stripped);
    setClashRevealed(true);
  }

  function focusOption(mode) {
    // Wait a tick so the toggle has re-rendered with its new selection.
    setTimeout(() => rootRef.current?.querySelector(`[data-mode-option="${mode}"]`)?.focus(), 0);
  }

  function handlePeopleChange(nextCount) {
    touch();
    setClashRevealed(true);
    const count = Math.max(1, nextCount);
    if (count === payers.length) return;

    if (count > payers.length) {
      if (payers.length === 1 && payers[0] === 'Me') renamePayer(0, '');
      const names = [...payers];
      let lastAdded = '';
      for (let n = payers.length + 1; n <= count; n += 1) {
        const label = nextPersonLabel(names, n);
        names.push(label);
        addPayer(label);
        lastAdded = label;
      }
      if (showChangeNotes && claimMode === 'host') {
        const keys = assignmentKeys(state);
        const items = parsed?.items ?? [];
        const joinsItems = items.some((item) => isDefaultAssignment(assignments[item.id], keys));
        setNote(
          joinsItems
            ? `Added ${lastAdded}. They're on every item you haven't changed yourself.`
            : `Added ${lastAdded}. Tick them on the items they share.`
        );
      } else {
        setNote('');
      }
    } else {
      const removedName = payers[payers.length - 1];
      for (let i = payers.length; i > count; i -= 1) {
        removePayer(payers[i - 1], i - 1);
      }
      if (count === 1 && (payers[0] === '' || payers[0] === undefined)) {
        renamePayer(0, 'Me');
      }
      if (showChangeNotes) {
        const label = removedName && removedName.trim() ? removedName.trim() : `person ${payers.length}`;
        setNote(`Removed ${label} from the bill and from every item.`);
      } else {
        setNote('');
      }
    }
  }

  function handleModeChange(next) {
    if (!next || next === claimMode) return;
    touch();
    if (next === 'payers' && hasHandAssignedItems(state)) {
      setPendingSwitch(true);
      return;
    }
    setNote('');
    setClaimMode(next);
  }

  function clearAndSwitch() {
    setPendingSwitch(false);
    setClaimMode('payers');
    setNote('Switched. Items are now not yet claimed.');
    focusOption('payers');
  }

  function keepAsIs() {
    setPendingSwitch(false);
    focusOption('host');
  }

  // After a removal the note can name how many items now need someone.
  let statusText = note;
  if (showChangeNotes && note.startsWith('Removed ') && claimMode === 'host') {
    const empty = countUnallocatedItems(state);
    if (empty > 0) {
      statusText = `${note} ${empty} ${empty === 1 ? 'item now needs' : 'items now need'} someone assigned.`;
    }
  }

  return (
    <div ref={rootRef} className="space-y-4" data-testid="roster-editor">
      <div className="space-y-1">
        <span className="block text-sm text-slate-600">How many people, including you?</span>
        <PeopleStepper count={payers.length} onChange={handlePeopleChange} />
        {solo && (
          <p className="text-sm text-slate-600" data-testid="solo-helper">
            Just you for now. Add people if you're sharing this bill.
          </p>
        )}
      </div>

      {!solo && (
        <div className="space-y-2" data-testid="name-rows">
          {payers.map((name, index) => {
            const message =
              showErrors || (clashRevealed && validation.clashOnlyIndices.includes(index))
                ? validation.messageFor(index)
                : null;
            return (
              <div key={index} className="space-y-1">
                <input
                  type="text"
                  value={name}
                  maxLength={20}
                  placeholder={index === 0 ? undefined : `Person ${index + 1}`}
                  onChange={(e) => renamePayer(index, e.target.value)}
                  onBlur={(e) => handleNameBlur(index, e.target.value)}
                  aria-label={index === 0 ? 'Your name' : `Name for person ${index + 1}`}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? `roster-row-${index}-error` : undefined}
                  className={`w-full min-h-[48px] rounded-md text-sm border ${
                    message ? 'border-red-700 ring-1 ring-red-700' : 'border-slate-300'
                  }`}
                />
                {message && (
                  <p id={`roster-row-${index}-error`} className="text-sm text-red-700">
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
          <span className="block text-sm text-slate-600">Who picks the items?</span>
          <ToggleGroup.Root
            type="single"
            value={claimMode}
            onValueChange={handleModeChange}
            className="space-y-2"
          >
            <ToggleGroup.Item value="host" asChild>
              <motion.button
                type="button"
                data-mode-option="host"
                whileTap={TAP_SCALE}
                transition={TAP_TRANSITION}
                className={optionClass(claimMode === 'host')}
              >
                <span className="block text-sm font-medium">I'll assign the items</span>
                <span className="block text-sm text-slate-600">
                  You choose who has what. This is how Bilang works today.
                </span>
              </motion.button>
            </ToggleGroup.Item>
            <ToggleGroup.Item value="payers" asChild>
              <motion.button
                type="button"
                data-mode-option="payers"
                whileTap={TAP_SCALE}
                transition={TAP_TRANSITION}
                className={optionClass(claimMode === 'payers')}
              >
                <span className="block text-sm font-medium">Let everyone pick their own</span>
                <span className="block text-sm text-slate-600">
                  Each person opens the link and taps their own items.
                </span>
              </motion.button>
            </ToggleGroup.Item>
          </ToggleGroup.Root>
          {claimMode === 'payers' && (
            <p className="text-sm text-slate-600" role="status" data-testid="claim-mode-note">
              Anything nobody picks shows as 'not yet claimed'. Nobody pays for it until someone claims it.
            </p>
          )}

          {confirmVisible && (
            <div
              role="group"
              aria-labelledby="mode-switch-prompt"
              data-testid="mode-switch-confirm"
              className="rounded-lg border border-slate-300 bg-amber-50 p-3 space-y-2"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  keepAsIs();
                }
              }}
            >
              <p id="mode-switch-prompt" ref={promptRef} tabIndex={-1} className="text-sm text-slate-900">
                This clears who you've assigned. Clear and switch?
              </p>
              <motion.button
                type="button"
                onClick={clearAndSwitch}
                whileTap={TAP_SCALE}
                transition={TAP_TRANSITION}
                className="w-full min-h-[48px] rounded-lg bg-amber-500 text-slate-900 font-semibold py-3"
              >
                Clear and switch
              </motion.button>
              <motion.button
                type="button"
                onClick={keepAsIs}
                whileTap={TAP_SCALE}
                transition={TAP_TRANSITION}
                className="w-full min-h-[48px] rounded-lg border border-slate-300 bg-white text-slate-900 font-semibold py-3"
              >
                Keep as is
              </motion.button>
            </div>
          )}
        </div>
      )}

      {showChangeNotes && (
        <p role="status" className="text-sm text-slate-600" data-testid="roster-change-note">
          {statusText}
        </p>
      )}

      {showErrors && !validation.valid && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {validation.summaryMessage}
        </div>
      )}
    </div>
  );
}
