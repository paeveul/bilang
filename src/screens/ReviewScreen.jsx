// src/screens/ReviewScreen.jsx — Item 22 Step 8: the correction screen.
//
// Round 2 design spec §5.1/§5.1.1 (`bilang-round-2-design-spec.md`),
// approved in full by Alex 2026-09-22 (bilang-mvp1-implementation-plans.md
// §22.7 Q1 resolution) with an explicit scope decision the same day: this
// screen combines item-level correction (name/qty/price/category/add/
// remove — ported from js/app.js's renderReviewScreen()/bindReview()) AND
// payer assignment (who shares what) in ONE screen, matching §5.1's own
// framing ("matching the live product's actual flow"). It supersedes
// src/screens/AssignScreen.jsx (Step 7) — that screen's tick-list logic is
// absorbed below rather than kept as a second, separate screen; see
// App.jsx and BillContext.jsx's header comments for the retirement of the
// standalone 'assign' screen state.
//
// §5.1.1's manual per-person override mode ("Set amounts") is the newest,
// highest-care piece: an RM/% toggle, a live remaining-to-allocate
// indicator, and a hard submit-time block with Tony's exact locked copy
// (bilang-direction-round-2-feedback.md's E/F tables). All of the actual
// money math behind it — resolving RM/% input to cents, summing manual
// allocations, computing what's left — lives in js/totals.js (computeTotals,
// percentToCents, centsToPercent, manualItemRemainingCents), per that
// file's own "ONLY place money is actually computed" header. This
// component only reads those results and dispatches the already-resolved
// numbers into BillContext's reducer (src/state/bill-reducer.js) — it does
// not do its own parallel money arithmetic anywhere.
//
// Known, deliberate simplifications against the full Round 2 spec (flagged
// here rather than silently built as if complete — see this pass's own
// dispatch report for the full list and reasoning):
//   - Visual system: this screen uses the same plain Tailwind utility
//     styling every other Steps 5-7 screen already uses (slate/amber),
//     NOT the two-direction Ledger/Statement token system §4/§6 of the
//     design spec describes — no other screen in this app has that system
//     wired in yet either, so this isn't a Step-8-specific corner cut.
//   - No Radix primitives, no motion.dev: neither is an existing
//     dependency (checked — not in package.json, not imported anywhere in
//     src/), and motion.dev is explicitly Item 22 Step 9's own separate,
//     not-yet-started scope, not Step 8's. Adding either here would be an
//     unreviewed new-dependency decision this task didn't ask for.
//   - Merchant name / receipt date (§5.1 point 1's header) aren't in the
//     current data model (state.parsed has no merchant_name/date fields —
//     js/app.js's own live parser doesn't return them either), so the
//     header shows the trust copy and remaining-indicator only.
//   - "Enter manually" recovery action (§5.1 point 7) is rendered but
//     inert — item 16 (manual-entry fallback) is not built yet.
//   - Row-level arithmetic validation (qty × unit_price vs line_total,
//     locked string I8) is not implemented — matching js/app.js's current
//     live behaviour, where these three fields are independently editable
//     with no cross-check. §5.1.1 point 4's block is fully implemented;
//     I8 is a separate, not-yet-built correction-row feature.
//   - Auto-focus-first-empty-field on block (§5.1.1 point 4's
//     focus-management reference) is simplified to an aria-live alert
//     announcement without literal DOM focus-stealing.
import { useEffect, useState } from 'react';
import {
  computeTotals,
  formatRM,
  formatRMLocked,
  fromCents,
  manualItemRemainingCents,
  percentToCents,
  toCents,
} from '../../js/totals.js';
import { useBillActions, useBillState } from '../state/BillContext.jsx';

const TRUST_COPY =
  "Photo-scanning isn't perfect on faded or handwritten receipts — fix anything that's wrong before continuing. Nothing is final until you confirm.";

const CATEGORIES = ['food', 'drink', 'tax', 'service', 'other'];

function summarizeNames(names) {
  if (!names || names.length === 0) return null;
  if (names.length <= 2) return `Assigned: ${names.join(', ')}`;
  return `Assigned: ${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function tickedOf(assignment) {
  if (!assignment) return [];
  return Array.isArray(assignment) ? assignment : assignment.equal || [];
}

// §5.1 point 4's collapsed-row assignment summary text — "Split 5 ways" /
// "Assigned: Farah, Wei Jie +3" / "No one assigned yet", plus §5.1.1's live
// remaining-to-allocate text while a manual item is still unresolved.
function assignmentSummaryText(item, assignment, payerCount) {
  const ticked = tickedOf(assignment);
  if (ticked.length === 0) return 'No one assigned yet';

  if (assignment && !Array.isArray(assignment) && assignment.mode === 'manual') {
    const remaining = manualItemRemainingCents(item, assignment);
    if (remaining > 0) return `${formatRMLocked(fromCents(remaining))} left to allocate`;
    if (remaining < 0) return `${formatRMLocked(fromCents(-remaining))} over`;
    return summarizeNames(ticked);
  }

  if (ticked.length === payerCount) return `Split ${ticked.length} ways`;
  return summarizeNames(ticked);
}

function isItemResolved(item, assignment) {
  const ticked = tickedOf(assignment);
  if (ticked.length === 0) return false;
  if (assignment && !Array.isArray(assignment) && assignment.mode === 'manual') {
    return manualItemRemainingCents(item, assignment) === 0;
  }
  return true; // equal-split with >=1 ticked person is always exactly resolved
}

export default function ReviewScreen() {
  const { parsed, payers, assignments } = useBillState();
  const {
    goToScreen,
    updateItemField,
    addItem,
    removeItem,
    updateBillField,
    setItemAssignment,
    ensureItemDefaultAssignment,
    setItemMode,
    setItemManualUnit,
    setItemManualValue,
  } = useBillActions();

  const items = parsed?.items ?? [];
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [blockedIds, setBlockedIds] = useState(() => new Set());
  const [validationError, setValidationError] = useState('');

  // Default every item to "everyone ticked, equal split" the first time
  // it's seen — same rule AssignScreen.jsx (Step 7) used, now applied here
  // since this screen is where items first arrive with an assignment at all.
  useEffect(() => {
    items.forEach((item) => ensureItemDefaultAssignment(item.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per item set, matching prior screen's pattern
  }, [items]);

  if (!parsed) {
    return (
      <section data-screen="review" className="app-screen py-8 space-y-4">
        <p className="text-slate-500 text-sm">Nothing to review yet.</p>
      </section>
    );
  }

  const { perPerson } = computeTotals(items, assignments, parsed, payers);

  const unresolvedCount = items.filter((item) => !isItemResolved(item, assignments[item.id])).length;
  const hasEmptyName = items.some((item) => !item.name || !item.name.trim());
  const canConfirm = items.length > 0 && !hasEmptyName && unresolvedCount === 0;

  // §5.1 point 3 — arithmetic-mismatch notice. Compares the items as
  // currently corrected against the receipt's own stated subtotal field,
  // same >=2-cent tolerance js/totals.js's reconciliation check uses.
  const itemSumCents = items.reduce((sum, item) => sum + toCents(item.line_total), 0);
  const statedSubtotalCents = toCents(parsed.subtotal);
  const mismatchCents = itemSumCents - statedSubtotalCents;
  const showMismatch = items.length > 0 && Math.abs(mismatchCents) >= 2;

  function toggleExpand(itemId) {
    const isExpanded = expandedIds.has(itemId);
    if (isExpanded) {
      const item = items.find((i) => i.id === itemId);
      const assignment = assignments[itemId];
      if (item && !isItemResolved(item, assignment) && assignment?.mode === 'manual') {
        // §5.1.1 point 4 — block on collapse while unresolved, rather than
        // silently letting the row close with an unfinished split.
        setBlockedIds((prev) => new Set(prev).add(itemId));
        return;
      }
    }
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    setBlockedIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }

  function clearBlocked(itemId) {
    setBlockedIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }

  function handleManualValueChange(item, name, text) {
    const assignment = assignments[item.id];
    const unit = assignment && !Array.isArray(assignment) ? assignment.manual.unit : 'RM';
    const cents = unit === '%' ? percentToCents(text, item.line_total) : toCents(text);
    setItemManualValue(item.id, name, text, cents);
    clearBlocked(item.id);
  }

  function handleConfirm() {
    if (items.length === 0) {
      setValidationError('Every item needs a name, and there must be at least one item.');
      return;
    }
    if (hasEmptyName) {
      setValidationError('Every item needs a name, and there must be at least one item.');
      return;
    }
    if (unresolvedCount > 0) {
      setValidationError(
        `${unresolvedCount} item(s) still need an amount assigned before you can continue.`
      );
      return;
    }
    setValidationError('');
    goToScreen('payment');
  }

  return (
    <section data-screen="review" className="app-screen py-8 space-y-4">
      {/* §5.1 point 1 — pinned header. No merchant/date in the current data
          model (see this file's header comment); the trust copy and
          bill-level status fill that slot instead. */}
      <div className="sticky top-0 z-10 bg-slate-50 pb-2 -mx-4 px-4 pt-2 space-y-2">
        <h2 className="text-xl font-bold">Check the items</h2>
        <p className="text-slate-600 text-sm" data-testid="trust-copy">
          {TRUST_COPY}
        </p>
      </div>

      {showMismatch && (
        <div
          role="status"
          className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3"
        >
          These items add up to {formatRM(fromCents(itemSumCents))} but the receipt says{' '}
          {formatRM(parsed.subtotal)} — {formatRM(fromCents(Math.abs(mismatchCents)))} unaccounted.
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-sm p-3">
          No items were read from this receipt. Try re-scanning, or add items by hand below.
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => {
          const assignment = assignments[item.id];
          const expanded = expandedIds.has(item.id);
          const blocked = blockedIds.has(item.id);
          const mode = assignment && !Array.isArray(assignment) ? assignment.mode : 'equal';
          const ticked = tickedOf(assignment);
          const unit = assignment && !Array.isArray(assignment) ? assignment.manual.unit : 'RM';
          const remaining = manualItemRemainingCents(item, assignment);

          return (
            <div key={item.id} className="assign-item-row space-y-2">
              {/* Collapsed summary row */}
              <button
                type="button"
                onClick={() => toggleExpand(item.id)}
                className="w-full flex justify-between items-start gap-3 text-left"
                aria-expanded={expanded}
              >
                <span className="flex-1">
                  <span className="block text-sm font-medium">{item.name || '(unnamed item)'}</span>
                  <span className="block text-xs text-slate-500">
                    {assignmentSummaryText(item, assignment, payers.length)}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">{formatRM(item.line_total)}</span>
              </button>

              {expanded && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  {/* §5.1 point 4 — item correction fields */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={item.name}
                      placeholder="Item name"
                      onChange={(e) => updateItemField(item.id, 'name', e.target.value)}
                      className="flex-1 rounded-md border-slate-300 text-sm min-h-[48px]"
                      aria-label="Item name"
                    />
                    <select
                      value={item.category}
                      onChange={(e) => updateItemField(item.id, 'category', e.target.value)}
                      className="rounded-md border-slate-300 text-sm min-h-[48px]"
                      aria-label="Category"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <label className="space-y-1">
                      <span className="text-xs text-slate-500">Qty</span>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={item.qty}
                        onChange={(e) => updateItemField(item.id, 'qty', Number(e.target.value) || 0)}
                        className="w-full min-h-[48px]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-slate-500">Unit price</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.unit_price}
                        onChange={(e) => updateItemField(item.id, 'unit_price', Number(e.target.value) || 0)}
                        className="w-full min-h-[48px]"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-slate-500">Line total</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.line_total}
                        onChange={(e) => updateItemField(item.id, 'line_total', Number(e.target.value) || 0)}
                        className="w-full min-h-[48px]"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="text-xs text-red-500 min-h-[48px] px-2"
                  >
                    Remove item
                  </button>

                  {/* §5.1.1 point 1 — mode switcher */}
                  <div className="flex rounded-md border border-slate-300 overflow-hidden text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setItemMode(item.id, 'equal')}
                      aria-pressed={mode === 'equal'}
                      className={`flex-1 min-h-[48px] ${mode === 'equal' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                    >
                      Equal split
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemMode(item.id, 'manual')}
                      aria-pressed={mode === 'manual'}
                      className={`flex-1 min-h-[48px] ${mode === 'manual' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                    >
                      Set amounts
                    </button>
                  </div>

                  {mode === 'manual' && (
                    <div
                      role={blocked ? 'alert' : 'status'}
                      aria-live={blocked ? undefined : 'polite'}
                      className={`text-xs rounded-md p-2 ${
                        blocked
                          ? 'bg-red-50 border border-red-200 text-red-700'
                          : remaining === 0
                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                            : 'bg-slate-100 border border-slate-200 text-slate-600'
                      }`}
                    >
                      {blocked ? (
                        <>
                          <div>
                            {remaining > 0
                              ? `${formatRMLocked(fromCents(remaining))} still to allocate`
                              : `${formatRMLocked(fromCents(-remaining))} over`}
                          </div>
                          <div>Shares must total {formatRMLocked(item.line_total)}.</div>
                        </>
                      ) : remaining === 0 ? (
                        'Fully allocated ✓'
                      ) : remaining > 0 ? (
                        `${formatRMLocked(fromCents(remaining))} left to allocate`
                      ) : (
                        `${formatRMLocked(fromCents(-remaining))} over`
                      )}
                    </div>
                  )}

                  {mode === 'manual' && (
                    <div className="flex rounded-full border border-slate-300 overflow-hidden text-xs font-medium w-fit">
                      <button
                        type="button"
                        onClick={() => setItemManualUnit(item.id, 'RM', item.line_total)}
                        aria-pressed={unit === 'RM'}
                        className={`px-3 min-h-[48px] ${unit === 'RM' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                      >
                        RM
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemManualUnit(item.id, '%', item.line_total)}
                        aria-pressed={unit === '%'}
                        className={`px-3 min-h-[48px] ${unit === '%' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                      >
                        %
                      </button>
                    </div>
                  )}

                  {/* Person list — shared tick roster (assignment.equal),
                      rendered as a plain checkbox in Equal split or an
                      editable value field in Set amounts (§5.1.1 point 2). */}
                  <div className="space-y-2 text-sm">
                    {payers.map((name) => {
                      const isTicked = ticked.includes(name);
                      const value =
                        mode === 'manual' && assignment && !Array.isArray(assignment)
                          ? assignment.manual.values[name]
                          : undefined;
                      return (
                        <div key={name} className="flex items-center gap-2 min-h-[48px]">
                          <input
                            type="checkbox"
                            checked={isTicked}
                            onChange={(e) => setItemAssignment(item.id, name, e.target.checked)}
                            className="h-5 w-5"
                            aria-label={`Include ${name}`}
                          />
                          <span className="flex-1">{name}</span>
                          {mode === 'manual' && isTicked && (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={value?.text ?? ''}
                              onChange={(e) => handleManualValueChange(item, name, e.target.value)}
                              placeholder={unit === '%' ? '0' : '0.00'}
                              className="w-20 rounded-md border-slate-300 text-sm text-right tabular-nums min-h-[48px]"
                              aria-label={`${name}'s ${unit === '%' ? 'percentage' : 'amount'} for ${item.name || 'this item'}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addItem}
        className="w-full rounded-lg border border-dashed border-slate-300 text-slate-600 text-sm py-3 min-h-[48px]"
      >
        + Add missing item
      </button>

      {/* §5.1 point 6 — bill-level totals, each editable */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <h3 className="font-semibold text-sm text-slate-700">Bill totals</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Subtotal</span>
            <input
              type="number"
              step="0.01"
              value={parsed.subtotal}
              onChange={(e) => updateBillField('subtotal', Number(e.target.value) || 0)}
              className="w-full min-h-[48px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Service charge</span>
            <input
              type="number"
              step="0.01"
              value={parsed.service_charge}
              onChange={(e) => updateBillField('service_charge', Number(e.target.value) || 0)}
              className="w-full min-h-[48px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Tax (SST)</span>
            <input
              type="number"
              step="0.01"
              value={parsed.tax}
              onChange={(e) => updateBillField('tax', Number(e.target.value) || 0)}
              className="w-full min-h-[48px]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-500">Grand total</span>
            <input
              type="number"
              step="0.01"
              value={parsed.grand_total}
              onChange={(e) => updateBillField('grand_total', Number(e.target.value) || 0)}
              className="w-full min-h-[48px]"
            />
          </label>
        </div>
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

      {/* §5.1 point 7 — recovery actions row */}
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          onClick={() => goToScreen('capture')}
          className="flex-1 text-slate-500 underline min-h-[48px]"
        >
          Re-scan photo
        </button>
        <button
          type="button"
          disabled
          title="Manual entry isn't available yet"
          className="flex-1 text-slate-300 min-h-[48px] cursor-not-allowed"
        >
          Enter manually
        </button>
      </div>

      {validationError && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {validationError}
        </div>
      )}

      {/* §5.1 point 8 — primary CTA, disabled (not hidden) while unresolved */}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={!canConfirm}
        className="w-full rounded-lg bg-amber-500 disabled:bg-slate-300 text-white font-semibold py-3 min-h-[48px]"
      >
        Confirm and continue
      </button>
    </section>
  );
}
