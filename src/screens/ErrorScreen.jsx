import { useBillState } from '../state/BillContext.jsx';

export default function ErrorScreen() {
  const { errorMessage } = useBillState();
  return (
    <section data-screen="error" className="app-screen py-16 text-center space-y-4">
      <p className="text-4xl">😕</p>
      <p className="text-slate-600">{errorMessage}</p>
      <button
        type="button"
        className="text-sm text-amber-600 underline"
        onClick={() => {
          window.location.href = '/';
        }}
      >
        Start over
      </button>
    </section>
  );
}
