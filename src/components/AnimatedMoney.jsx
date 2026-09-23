// src/components/AnimatedMoney.jsx — Item 22 Step 9: the "Totals recalculating"
// motion.dev placement (bilang-mvp1-implementation-plans.md §22.3's placements
// table). Shared by every on-screen money figure that recomputes live as the
// user edits an assignment — the correction screen's per-item "remaining to
// allocate" indicator and the running per-person totals, today; any future
// server-pushed total (Item 21 Phase B) is meant to reuse this component too.
//
// THE SAFETY REQUIREMENT THIS FILE EXISTS TO ENFORCE (§22.3): "Money figures
// must never animate into their final state. Animate while editing; snap
// instantly and exactly on blur, on confirm, and on any server-authoritative
// update. A number still gliding when confirm is pressed shows the user a
// figure that is not the one being submitted." That is not a visual-polish
// note — showing an in-flight number at the exact moment of a monetary
// commitment is a correctness bug wearing an animation.
//
// Mechanism: `useSpring(cents, ...)` (motion/react) returns a MotionValue that
// smoothly interpolates toward whatever value `.set()` is last given —
// exactly "animate while editing". `.jump(value)` (motion-dom's MotionValue,
// confirmed present in the installed `motion` 13.4.1 — see
// node_modules/motion-dom/dist/index.d.ts) sets the value instantly with no
// animation frames at all — exactly "snap instantly and exactly". The caller
// decides which one happens by bumping `snapTick` (any number that changes)
// in the same render pass as the new `cents` value: if `snapTick` differs
// from the value seen on the previous commit, this component jumps; if only
// `cents` changed, it animates. The very first mount always jumps — there is
// no "entrance animation" for a total that simply appears.
//
// `useTransform(spring, fn)` derives a second MotionValue holding the
// formatted RM string; passing a MotionValue directly as a `motion.span`
// child (rather than through `style`) is motion/react's documented pattern
// for animating text content without triggering a React re-render on every
// frame — the number's glide is real DOM text mutation, not React reconciliation,
// which is also why this is cheap enough to use on several rows at once
// without touching B1's bundle-weight/runtime-cost budget in any real way.
import { useEffect, useRef } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';
import { formatRM, formatRMLocked, fromCents } from '../../js/totals.js';

// `motionValueRef` is test-only (AnimatedMoney.test.jsx): it lets a test
// assert on the underlying spring's `.get()` value directly and
// synchronously, rather than through the DOM text node — which is the
// correct probe point for the jump-vs-animate DISCIPLINE this component
// exists to enforce, since `useTransform`'s own DOM write is independently
// frame-scheduled (it calls `motionDom.frame.preRender(...)`, confirmed by
// reading node_modules/framer-motion/dist/cjs/index.js's
// useCombineMotionValues) even when the source spring itself jumped with
// zero animation frames. That one-frame rendering latency is real but is a
// separate, ordinary rendering concern — not the money-safety property this
// component is responsible for, which is entirely about whether `.jump()`
// or `.set()` was called on the spring itself.
export default function AnimatedMoney({ cents, snapTick = 0, locked = false, className, motionValueRef, ...rest }) {
  const spring = useSpring(cents, { duration: 250, bounce: 0 });
  if (motionValueRef) motionValueRef.current = spring;
  const text = useTransform(spring, (v) => {
    const amount = fromCents(Math.round(v));
    return locked ? formatRMLocked(amount) : formatRM(amount);
  });

  const mounted = useRef(false);
  const prevSnapTick = useRef(snapTick);

  useEffect(() => {
    if (!mounted.current) {
      // First paint: show the real figure immediately, never an entrance
      // animation from zero (or from whatever the spring's default init is).
      spring.jump(cents);
      mounted.current = true;
      prevSnapTick.current = snapTick;
      return;
    }

    if (snapTick !== prevSnapTick.current) {
      // A blur, a confirm attempt, or a server-authoritative update fired
      // between the last commit and this one — land on the new figure with
      // zero animation frames, per the safety requirement above.
      spring.jump(cents);
      prevSnapTick.current = snapTick;
      return;
    }

    // Ordinary live recompute while the user is still editing — animate.
    spring.set(cents);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- spring/text are stable MotionValue instances, not reactive deps
  }, [cents, snapTick]);

  return (
    <motion.span className={className} data-testid={rest['data-testid']}>
      {text}
    </motion.span>
  );
}
