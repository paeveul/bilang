// src/screens/ParsingScreen.jsx — Item 22 Step 5 (mechanical, presentational)
// + Step 9's "Scan wait" motion.dev placement (§22.3).
//
// §22.3's constraint for this placement: "Must loop indefinitely with no
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
import { motion } from 'motion/react';

export default function ParsingScreen() {
  return (
    <section data-screen="parsing" className="app-screen py-16 text-center space-y-4">
      <motion.div
        role="status"
        aria-label="Reading your receipt"
        className="mx-auto h-10 w-10 rounded-full border-4 border-amber-500 border-t-transparent"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
      />
      <p className="text-slate-600">Reading your receipt…</p>
    </section>
  );
}
