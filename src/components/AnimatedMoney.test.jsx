// src/components/AnimatedMoney.test.jsx — Item 22 Step 9: the safety-critical
// half of the "Totals recalculating" motion.dev placement (§22.3 of
// bilang-mvp1-implementation-plans.md): "Money figures must never animate
// into their final state. Animate while editing; snap instantly and exactly
// on blur, on confirm, and on any server-authoritative update."
//
// What this file actually proves, and what it deliberately does NOT try to
// prove: real spring physics timing (how many milliseconds an animation
// takes, its easing curve) is a rendering concern that depends on real
// requestAnimationFrame cadence, which jsdom does not reproduce faithfully
// enough to assert against without a flaky, timing-sensitive test. What
// matters for correctness is the DISCIPLINE — does AnimatedMoney call
// `spring.jump()` (instant, zero animation frames) or `spring.set()`
// (schedules a spring animation) — and that is asserted directly against
// the underlying MotionValue's own `.get()`, via the test-only
// `motionValueRef` prop (see AnimatedMoney.jsx's header comment on that
// prop for why this is the correct probe point, rather than the rendered
// DOM text: the DOM write goes through a SEPARATE, independently
// frame-scheduled `useTransform` derivation — real, but a distinct ordinary
// rendering-latency concern, not the money-safety property under test
// here). `spring.jump(v)` sets `.get()` to `v` synchronously (confirmed by
// reading node_modules/motion-dom/dist/cjs/index.js's `jump()`, which calls
// `updateAndNotify` — itself synchronous — with no frame scheduling
// involved at all); `spring.set(v)` does not.
import '../test/jsdom-setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useRef, useState } from 'react';
import AnimatedMoney from './AnimatedMoney.jsx';

test.afterEach(() => {
  cleanup();
});

test('mount: the first paint shows the real figure immediately — no entrance animation', () => {
  const { container } = render(<AnimatedMoney cents={1234} data-testid="m" />);
  assert.equal(container.textContent, 'RM12.34');
});

test('editing (snapTick unchanged): a cents change animates — the spring does NOT reach the new value synchronously', () => {
  function Harness({ springRef }) {
    const [cents, setCents] = useState(1000);
    return (
      <div>
        <AnimatedMoney cents={cents} snapTick={0} motionValueRef={springRef} />
        <button type="button" onClick={() => setCents(5000)}>
          bump
        </button>
      </div>
    );
  }

  let capturedRef;
  function Root() {
    const springRef = useRef(null);
    capturedRef = springRef;
    return <Harness springRef={springRef} />;
  }

  const { getByRole } = render(<Root />);
  assert.equal(capturedRef.current.get(), 1000, 'sanity check: initial jump landed on the spring itself');

  fireEvent.click(getByRole('button'));

  // §22.3's "animate while editing": `spring.set()` schedules a spring
  // animation toward 5000 — it must NOT already read 5000 in this same
  // synchronous tick, which is exactly what would happen if this path
  // called `.jump()` instead.
  assert.notEqual(
    capturedRef.current.get(),
    5000,
    'a mid-edit change must not reach the target value synchronously — that would mean it snapped, not animated'
  );
});

test('blur / confirm (snapTick bumped): a cents change snaps — the spring reaches the new value synchronously', () => {
  let capturedRef;
  function Root() {
    const springRef = useRef(null);
    capturedRef = springRef;
    const [cents, setCents] = useState(1000);
    const [snapTick, setSnapTick] = useState(0);
    return (
      <div>
        <AnimatedMoney cents={cents} snapTick={snapTick} motionValueRef={springRef} />
        <button
          type="button"
          onClick={() => {
            // Mirrors ReviewScreen.jsx's handleManualValueBlur / the top of
            // handleConfirm: bump snapTick in the same commit as the new
            // cents value.
            setCents(5000);
            setSnapTick((n) => n + 1);
          }}
        >
          blur-or-confirm
        </button>
      </div>
    );
  }

  const { getByRole } = render(<Root />);
  assert.equal(capturedRef.current.get(), 1000);

  fireEvent.click(getByRole('button'));

  // This is the exact requirement from §22.3: at the moment of blur/confirm,
  // the underlying value must already BE the figure being committed — not
  // still mid-animation toward it.
  assert.equal(
    capturedRef.current.get(),
    5000,
    'on blur/confirm the spring must reach the new figure instantly, in the same synchronous tick'
  );
});

test('locked=true uses the space-separated "RM 12.34" format (Tony\'s locked-copy convention), not "RM12.34"', () => {
  const { container } = render(<AnimatedMoney cents={1234} locked />);
  assert.equal(container.textContent, 'RM 12.34');
});
