// src/App.jsx — Item 22 Steps 2, 5, 6, 7: app shell.
//
// The internal screens (everything except the payer view) share one URL
// ("/") today. This is now the confirmed final shape, not a placeholder —
// see src/router.jsx's "ROUTING SHAPE — RESOLVED" note (Alex, 2026-09-14):
// six of these screens (capture, review, assign, roster, correction,
// payment-handle) stay session-only permanently; the credit-pack-picker
// and account-settings screens will get their own real URLs when items
// 11 and 18 build them, which this shell does not do.
//
// Steps 5-7 (this pass) replace ScreenStub with real content for every
// screen except 'review' — that screen is Item 22 Step 8 in full (the
// Round 2 correction-screen rebuild, gated on §22.7 Q1, explicitly out of
// scope for this dispatch) and stays a ScreenStub. This is a real,
// flagged gap: the landing→capture→review→assign→payment→share path
// cannot be walked end-to-end through the UI until Step 8 lands, since
// nothing after capture can hand real reviewed items to AssignScreen. See
// this pass's dispatch report for how AssignScreen/PaymentScreen were
// independently verified in the meantime.
import { RouterProvider, useRouter } from './router.jsx';
import { BillProvider, useBillState } from './state/BillContext.jsx';
import PayerScreen from './screens/PayerScreen.jsx';
import ScreenStub from './screens/ScreenStub.jsx';
import LandingScreen from './screens/LandingScreen.jsx';
import CaptureScreen from './screens/CaptureScreen.jsx';
import ParsingScreen from './screens/ParsingScreen.jsx';
import AssignScreen from './screens/AssignScreen.jsx';
import PaymentScreen from './screens/PaymentScreen.jsx';
import CreatingScreen from './screens/CreatingScreen.jsx';
import ShareScreen from './screens/ShareScreen.jsx';
import ErrorScreen from './screens/ErrorScreen.jsx';

// Order matches index.html's existing data-screen sections, in document order.
const SCREEN_NAMES = [
  'landing',
  'capture',
  'parsing',
  'review',
  'assign',
  'payment',
  'creating',
  'share',
  'error',
];

function AppShell() {
  const { screen } = useBillState();

  switch (screen) {
    case 'landing':
      return <LandingScreen />;
    case 'capture':
      return <CaptureScreen />;
    case 'parsing':
      return <ParsingScreen />;
    case 'review':
      // Step 8, not this pass — see this file's header comment.
      return <ScreenStub name="review" screenNumber={SCREEN_NAMES.indexOf('review') + 1} />;
    case 'assign':
      return <AssignScreen />;
    case 'payment':
      return <PaymentScreen />;
    case 'creating':
      return <CreatingScreen />;
    case 'share':
      return <ShareScreen />;
    case 'error':
    default:
      return <ErrorScreen />;
  }
}

function Routes() {
  const { route, params } = useRouter();
  if (route === 'payer') {
    return (
      <div className="mx-auto max-w-lg px-4 pb-16">
        <PayerScreen id={params.id} />
      </div>
    );
  }
  return (
    <BillProvider>
      <div className="mx-auto max-w-lg px-4 pb-16">
        <AppShell />
      </div>
    </BillProvider>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-lg tracking-tight">🧾 Bilang</span>
          <span className="text-xs text-slate-400">by Paeveul</span>
        </div>
      </header>
      <main>
        <Routes />
      </main>
    </RouterProvider>
  );
}
