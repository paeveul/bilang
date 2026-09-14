// src/App.jsx — Item 22 Step 2: app shell.
//
// The eight/nine internal screens (everything except the payer view)
// still share one URL ("/") today — see src/router.jsx's note. This
// component stands in for js/app.js's screen state machine so Step 2 can
// prove every screen name is reachable, without migrating any screen's
// actual content (Steps 5-8).
import { useState } from 'react';
import { RouterProvider, useRouter } from './router.jsx';
import PayerScreen from './screens/PayerScreen.jsx';
import ScreenStub from './screens/ScreenStub.jsx';

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
  const [screen] = useState('landing');
  const screenNumber = SCREEN_NAMES.indexOf(screen) + 1;
  return (
    <div className="mx-auto max-w-lg px-4 pb-16">
      <ScreenStub name={screen} screenNumber={screenNumber} />
    </div>
  );
}

function Routes() {
  const { route, params } = useRouter();
  if (route === 'payer') return <PayerScreen id={params.id} />;
  return <AppShell />;
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
