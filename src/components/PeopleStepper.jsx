// src/components/PeopleStepper.jsx — Item 24 Step 6. Design spec §1.2 row 3,
// §3 "genuinely new" table: minus/number/plus, 48x48 targets, `role="group"`,
// the count announced as "N people" (not conveyed by colour alone — §4
// accessibility checklist). Dumb/presentational: RosterGate.jsx owns what
// happens on increment/decrement (adding/removing a roster row).
import { motion } from 'motion/react';

const TAP_SCALE = { scale: 0.97 };
const TAP_TRANSITION = { duration: 0.1 };

export default function PeopleStepper({ count, onChange, min = 1 }) {
  return (
    <div role="group" aria-label="How many people, including you?" className="flex items-center gap-4">
      <motion.button
        type="button"
        whileTap={count > min ? TAP_SCALE : undefined}
        transition={TAP_TRANSITION}
        disabled={count <= min}
        onClick={() => onChange(count - 1)}
        aria-label="Fewer people"
        className="h-12 w-12 min-h-[48px] min-w-[48px] rounded-lg border border-slate-300 text-xl font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        −
      </motion.button>
      <span className="text-xl font-bold tabular-nums w-8 text-center" aria-live="polite">
        {count}
      </span>
      <span className="sr-only" aria-live="polite">
        {count} {count === 1 ? 'person' : 'people'}
      </span>
      <motion.button
        type="button"
        whileTap={TAP_SCALE}
        transition={TAP_TRANSITION}
        onClick={() => onChange(count + 1)}
        aria-label="More people"
        className="h-12 w-12 min-h-[48px] min-w-[48px] rounded-lg border border-slate-300 text-xl font-semibold text-slate-700"
      >
        +
      </motion.button>
    </div>
  );
}
