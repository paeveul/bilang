//
//
import { MotionConfig } from 'motion/react';
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
import AuthScreen from './screens/AuthScreen.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';

const SCREEN_NAMES = [
  'landing',
  'capture',
  'parsing',
  'review',
  'assign', // retired step, no longer part of the flow
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

function CreatorGate() {
  const { phase, startupError, overlayOpen, markSignedIn } = useAuth();

  if (phase === 'checking') {
    return <p className="py-16 text-center text-slate-600">Checking your sign-in…</p>;
  }
  if (phase === 'signed-out') {
    return <AuthScreen variant="page" startupError={startupError} onSignedIn={markSignedIn} />;
  }
  return (
    <>
      <AppShell />
      {overlayOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
            <AuthScreen variant="overlay" onSignedIn={markSignedIn} />
          </div>
        </div>
      )}
    </>
  );
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
    <AuthProvider>
      <BillProvider>
        <div className="mx-auto max-w-lg px-4 pb-16">
          <CreatorGate />
        </div>
      </BillProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
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
    </MotionConfig>
  );
}
