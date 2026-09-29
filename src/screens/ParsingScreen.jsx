// src/screens/ParsingScreen.jsx — Item 22 Step 5 (mechanical, presentational)
// + Step 9's "Scan wait" motion.dev placement (§22.3) + Item 24 Step 6's
// roster gate (`bilang-item-24-roster-gate-and-claim-screens.md` §1.1: "the
// roster gate lives on the existing ParsingScreen, below the spinner. Not a
// new route, not a new screen state").
//
// Placement decision (§1.1): the gate starts while the scan is still
// running and ends when BOTH the scan has finished AND the host taps
// Continue. If the host never touches it, today's behaviour is unchanged —
// the moment `parsed` lands, this screen advances to 'review' on its own,
// with zero added friction for a solo bill. If the host DID touch the
// gate, this screen never auto-advances (no yanking a mid-typing screen
// away); Continue simply goes from disabled ("Reading your receipt…") to
// enabled the instant the scan lands. CaptureScreen.jsx (the caller) no
// longer calls goToScreen('review') itself after a successful parse — see
// that file's header comment — this screen is what decides when to leave,
// now that leaving depends on the gate too, not just "parsing finished".
//
// §22.3's constraint for the spin loop: "Must loop indefinitely with no
// implied percentage of completion — the app cannot know how long Claude
// will take, and a determinate progress bar would be a lie." A continuous,
// constant-speed 360° rotation loop (`repeat: Infinity`, `ease: 'linear'`)
// satisfies this by construction: there is no start/end state to read a
// percentage from, unlike a fill-bar or a value that eases toward 100%.
// `repeatType: 'loop'` (the default) plus a linear ease keeps the speed
// constant too, so nothing about the motion itself suggests acceleration
// toward a finish line.
//
// Reduced motion: inherited for free from App.jsx's
// `<MotionConfig reducedMotion="user">` — no per-component check needed here.
// When the OS has reduce-motion on, motion/react drops this to a static
// (non-animating) frame automatically; the "Reading your receipt…" text
// still communicates the wait state on its own.
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import RosterGate from './RosterGate.jsx';
import { useBillActions, useBillState } from '../state/BillContext.jsx';

export default function ParsingScreen() {
  const { parsed } = useBillState();
  const { goToScreen } = useBillActions();
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const scanDone = Boolean(parsed);

  // §1.1 "What if the host never touches it? Today's behaviour: scan
  // finishes, Review opens automatically." Runs only while untouched — the
  // moment the host interacts with the gate, this effect's own condition
  // (`!touched`) stops it from firing, and only the gate's own Continue
  // button (RosterGate's onContinue -> here) can advance the screen.
  useEffect(() => {
    if (scanDone && !touched) {
      goToScreen('review');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per scanDone/touched transition, matching prior screens' pattern
  }, [scanDone, touched]);

  return (
    <section data-screen="parsing" className="app-screen py-16 text-center space-y-6">
      <div className="space-y-4">
        <motion.div
          role="status"
          aria-label="Reading your receipt"
          className="mx-auto h-10 w-10 rounded-full border-4 border-amber-500 border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
        />
        <p className="text-slate-600">Reading your receipt…</p>
      </div>

      <RosterGate
        scanDone={scanDone}
        touched={touched}
        onTouch={() => setTouched(true)}
        onContinue={() => goToScreen('review')}
        showErrors={showErrors}
        onShowErrors={setShowErrors}
      />
    </section>
  );
}
