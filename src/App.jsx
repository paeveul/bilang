// src/App.jsx — Item 22 Steps 2, 5, 6, 7, 8: app shell.
//
// The internal screens (everything except the payer view) share one URL
// ("/") today. This is now the confirmed final shape, not a placeholder —
// see src/router.jsx's "ROUTING SHAPE — RESOLVED" note (Alex, 2026-09-14):
// these screens stay session-only permanently; the credit-pack-picker and
// account-settings screens will get their own real URLs when items 11 and
// 18 build them, which this shell does not do.
//
// Steps 5-7 replaced ScreenStub with real content for every screen except
// 'review'. Step 8 (this pass) finishes that: 'review' is now
// ReviewScreen.jsx, the Round 2 correction-screen rebuild (§5.1/§5.1.1,
// approved in full 2026-09-22, §22.7 Q1). Per that same day's scope
// decision, ReviewScreen.jsx combines correction AND assignment into one
// screen — 'assign' is retired as its own screen state and AssignScreen.jsx
// (Step 7) is removed; its tick-list logic lives inside ReviewScreen.jsx
// now. The landing→capture→review→payment→create→share path is walkable
// end-to-end through the UI as of this pass.
import { RouterProvider, useRouter } from './router.jsx';
import { BillProvider, useBillState } from './state/BillContext.jsx';
import PayerScreen from './screens/PayerScreen.jsx';
import LandingScreen from './screens/LandingScreen.jsx';
import CaptureScreen from './screens/CaptureScreen.jsx';
import ParsingScreen from './screens/ParsingScreen.jsx';
import ReviewScreen from './screens/ReviewScreen.jsx';
import PaymentScreen from './screens/PaymentScreen.jsx';
import CreatingScreen from './screens/CreatingScreen.jsx';
import ShareScreen from './screens/ShareScreen.jsx';
import ErrorScreen from './screens/ErrorScreen.jsx';

// Order matches index.html's existing data-screen sections, in document
// order. 'assign' is kept here as a historical marker only (Step 7 built
// it, Step 8 retired it as a distinct screen state — see this file's
// header comment) — AppShell below no longer has a case for it.
const SCREEN_NAMES = [
  'landing',
  'capture',
  'parsing',
  'review',
  'assign', // retired 2026-09-22 — see header comment
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
      return <ReviewScreen />;
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
