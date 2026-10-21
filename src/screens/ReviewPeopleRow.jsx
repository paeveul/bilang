// The "People" row at the top of Review: a one-line summary with Edit, which
// opens the shared RosterEditor inline. Edits are live (there is no separate
// save); Done closes the panel, and it stays open while a name is invalid.
import { useEffect, useRef } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import { motion } from 'motion/react';
import { useBillState } from '../state/BillContext.jsx';
import RosterEditor from './RosterEditor.jsx';
import { summarizeRoster, validateRoster } from './roster-validation.js';

const TAP_SCALE = { scale: 0.97 };
const TAP_TRANSITION = { duration: 0.1 };

export default function ReviewPeopleRow({ open, onOpenChange, showErrors, onShowErrors, onBlocked, focusTick }) {
  const { payers } = useBillState();
  const summary = summarizeRoster(payers);
  const validation = validateRoster(payers);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const wasOpen = useRef(false);

  // Focus moves into the editor when it opens (a non-text control, so a
  // phone keyboard does not pop up) and back to the trigger when it closes.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const t = setTimeout(() => panelRef.current?.focus(), 0);
      wasOpen.current = true;
      return () => clearTimeout(t);
    }
    if (!open && wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
    return undefined;
  }, [open]);

  // A blocked Confirm or Done bumps focusTick: send focus to the first bad name.
  useEffect(() => {
    if (!focusTick) return undefined;
    const focusFirst = () => panelRef.current?.querySelector('[aria-invalid="true"]')?.focus();
    focusFirst();
    const t = setTimeout(focusFirst, 0);
    return () => clearTimeout(t);
  }, [focusTick]);

  function tryClose() {
    if (!validation.valid) {
      onShowErrors(true);
      onBlocked();
      return;
    }
    onShowErrors(false);
    onOpenChange(false);
  }

  const stateLabel = open ? 'Done' : 'Edit';
  const spoken = `People: ${summary.count}, ${summary.names}. ${open ? 'Done editing people.' : 'Edit people.'}`;

  return (
    <Accordion.Root
      type="single"
      collapsible
      value={open ? 'people' : ''}
      onValueChange={(next) => {
        if (next === 'people') onOpenChange(true);
        else tryClose();
      }}
      className="bg-white rounded-xl border border-slate-400"
      data-testid="people-row"
    >
      <Accordion.Item value="people">
        <Accordion.Header>
          <Accordion.Trigger asChild>
            <motion.button
              ref={triggerRef}
              type="button"
              whileTap={TAP_SCALE}
              transition={TAP_TRANSITION}
              aria-label={spoken}
              className="w-full min-h-[56px] flex items-center gap-3 px-4 py-2 text-left"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-slate-600" fill="currentColor">
                <circle cx="10" cy="6" r="3.5" />
                <path d="M3 17c0-3.6 3.1-6 7-6s7 2.4 7 6z" />
              </svg>
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900" data-testid="people-summary">
                {summary.text}
              </span>
              <span className="shrink-0 text-sm font-semibold text-amber-700" aria-hidden="true">
                {stateLabel}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className={`h-5 w-5 shrink-0 text-slate-600 ${open ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 8l5 5 5-5" />
              </svg>
            </motion.button>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content>
          {open && (
            <div
              ref={panelRef}
              role="group"
              aria-label="Edit people"
              tabIndex={-1}
              className="space-y-4 border-t border-slate-200 px-4 py-4 outline-none"
            >
              <RosterEditor showErrors={showErrors} showChangeNotes />
              <motion.button
                type="button"
                onClick={tryClose}
                whileTap={TAP_SCALE}
                transition={TAP_TRANSITION}
                className="w-full min-h-[48px] rounded-lg bg-amber-500 text-slate-900 font-semibold py-3"
              >
                Done
              </motion.button>
            </div>
          )}
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}
