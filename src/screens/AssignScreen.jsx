// src/screens/AssignScreen.jsx — Item 22 Step 7: assign / roster screen.
// Ported from index.html's data-screen="assign" + js/app.js's
// renderAssignScreen()/bindAssign(). Same behaviour: add/remove payers
// (the "roster"), tick who's covering each item, live per-person running
// totals recomputed via js/totals.js's computeTotals() (unchanged — the
// one place money is computed, per that file's own header comment).
//
// Note on scope: this screen reads state.parsed.items, which today is
// only populated by a real parseReceipt() call from CaptureScreen — the
// review/correction screen that normally sits between capture and this
// screen is Item 22 Step 8, explicitly out of scope for this dispatch
// (gated on Q1, Round 2 spec §5.1.1 approval). This screen's own logic
// (roster, assignment, live totals, validation) is built and independently
// correct either way — flagged in this pass's report as the one place the
// full landing→capture→…→share UI path cannot be exercised end-to-end
// until Step 8 lands, per 22.4 Step 7's own "full create flow" verify line.
import { useEffect } from 'react';
import { computeTotals, formatRM } from '../../js/totals.js';
import { useBillActions, useBillState } from '../state/BillContext.jsx';

export default function AssignScreen() {
  const { parsed, payers, assignments } = useBillState();
  const { addPayer, removePayer, setItemAssignment, ensureItemDefaultAssignment, goToScreen } =
    useBillActions();

  const items = parsed?.items ?? [];

  // Default: assign every item to everyone currently on the roster, the
  // first time that item is seen — matches js/app.js's renderAssignItems().
  useEffect(() => {
    items.forEach((item) => ensureItemDefaultAssignment(item.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per item set, matching vanilla behaviour
  }, [items]);

  function handleAddPayer(e) {
    e.preventDefault();
    const form = e.target;
    const input = form.elements.namedItem('name');
    const name = input.value.trim();
    if (name) addPayer(name);
    input.value = '';
  }

  const { perPerson } = computeTotals(items, assignments, parsed || {}, payers);
  const unassignedCount = items.filter((item) => (assignments[item.id] || []).length === 0).length;

  function handleConfirm() {
    if (unassignedCount > 0) return; // error shown inline below
    goToScreen('payment');
  }

  return (
    <section data-screen="assign" className="app-screen py-8 space-y-4">
      <h2 className="text-xl font-bold">Who had what?</h2>
      <p className="text-slate-600 text-sm">
        Add everyone splitting this bill, then tick who's covering each item. An item split
        between several people divides its cost evenly among them.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="font-semibold text-sm text-slate-700">Payers</h3>
        <div className="flex flex-wrap gap-2">
          {payers.map((name) => (
            <span key={name} className="payer-chip">
              {name}{' '}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                disabled={payers.length <= 1}
                onClick={() => removePayer(name)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={handleAddPayer} className="flex gap-2">
          <input
            type="text"
            name="name"
            placeholder="Add a name"
            maxLength={40}
            className="flex-1 rounded-md border-slate-300 text-sm"
          />
          <button type="submit" className="rounded-md bg-slate-800 text-white text-sm px-4">
            Add
          </button>
        </form>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const assignedTo = assignments[item.id] || [];
          return (
            <div key={item.id} className="assign-item-row">
              <div className="flex justify-between text-sm font-medium mb-2">
                <span>{item.name}</span>
                <span>{formatRM(item.line_total)}</span>
              </div>
              <div className="flex flex-wrap gap-3 text-sm assign-checkboxes">
                {payers.map((name) => (
                  <label key={name} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={assignedTo.includes(name)}
                      onChange={(e) => setItemAssignment(item.id, name, e.target.checked)}
                    />
                    <span>{name}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <h3 className="font-semibold text-sm text-slate-700">Running totals</h3>
        <div className="text-sm space-y-1">
          {payers.map((name) => (
            <div key={name} className="flex justify-between">
              <span>{name}</span>
              <span className="font-semibold">{formatRM((perPerson[name]?.totalCents ?? 0) / 100)}</span>
            </div>
          ))}
        </div>
      </div>

      {unassignedCount > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {unassignedCount} item(s) have no one assigned to them. Tick at least one payer per item.
        </div>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        className="w-full rounded-lg bg-amber-500 text-white font-semibold py-3"
      >
        Continue to payment details
      </button>
      <button
        type="button"
        className="text-sm text-slate-500 underline"
        onClick={() => goToScreen('review')}
      >
        ← Back to items
      </button>
    </section>
  );
}
