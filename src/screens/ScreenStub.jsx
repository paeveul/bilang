// src/screens/ScreenStub.jsx — shared placeholder for the eight/nine
// screens not yet migrated (Steps 5-8 build real content here). Exists
// only so Step 2 can prove every screen name is reachable through the
// router/shell before any screen's actual UI is touched.
export default function ScreenStub({ name, screenNumber }) {
  return (
    <section data-screen={name} className="app-screen py-8 space-y-4">
      <p className="text-xs text-slate-400">
        Screen {screenNumber}/10 — <code>{name}</code> — not yet migrated (Item 22, Steps 5-8)
      </p>
    </section>
  );
}
