//
//
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
