//
//
//
//
//
import { useEffect, useRef, useState } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { motion } from 'motion/react';
import AnimatedMoney from '../components/AnimatedMoney.jsx';
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
import { validateItems } from './review-validation.js';
import ReviewPeopleRow from './ReviewPeopleRow.jsx';
import { validateRoster } from './roster-validation.js';

const TAP_TRANSITION = { duration: 0.1 };
const TAP_SCALE = { scale: 0.97 };

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

function assignmentSummaryText(item, assignment, payerCount, claimMode) {
  const ticked = tickedOf(assignment);
  if (ticked.length === 0) return claimMode === 'payers' ? 'Not yet claimed' : 'No one assigned yet';

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
  const { parsed, payers, assignments, claimMode } = useBillState();
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
  const [moneySnapTick, setMoneySnapTick] = useState(0);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [showRosterErrors, setShowRosterErrors] = useState(false);
  const [rosterFocusTick, setRosterFocusTick] = useState(0);

  const manualInputRefs = useRef({});

  // Item-field validation (mirrors the server's item rules — see
  // review-validation.js). `showItemErrors` flips on at the first failed
  // Confirm, so nobody sees red text before they've tried to continue;
  // after that the messages are live and clear as each field is fixed.
  // `pendingFocus` = { itemId, field } of the first problem, consumed by the
  // effect below once the (possibly just-expanded) row has rendered.
  const [showItemErrors, setShowItemErrors] = useState(false);
  const [pendingFocus, setPendingFocus] = useState(null);
  const fieldRefs = useRef({}); // `${itemId}:${field}` -> element

  function registerFieldRef(itemId, field, el) {
    const key = `${itemId}:${field}`;
    if (el) fieldRefs.current[key] = el;
    else delete fieldRefs.current[key];
  }

  useEffect(() => {
    if (!pendingFocus) return undefined;
    const key = `${pendingFocus.itemId}:${pendingFocus.field}`;
    const tryFocus = () => fieldRefs.current[key]?.focus();
    tryFocus();
    // Radix mounts a just-opened row's content a beat later on some paths.
    const t = setTimeout(tryFocus, 0);
    setPendingFocus(null);
    return () => clearTimeout(t);
  }, [pendingFocus]);

  function registerManualInputRef(itemId, name, el) {
    const forItem = manualInputRefs.current[itemId] || (manualInputRefs.current[itemId] = {});
    if (el) forItem[name] = el;
    else delete forItem[name];
  }

  function focusFirstUnresolvedInput(itemId) {
    const assignment = assignments[itemId];
    const ticked = tickedOf(assignment);
    const forItem = manualInputRefs.current[itemId];
    if (!forItem) return;
    for (const name of ticked) {
      const el = forItem[name];
      if (el) {
        el.focus();
        return;
      }
    }
  }

  useEffect(() => {
    if (claimMode !== 'host') return;
    items.forEach((item) => ensureItemDefaultAssignment(item.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per item set, matching prior screen's pattern
  }, [items, claimMode]);

  if (!parsed) {
    return (
      <section data-screen="review" className="app-screen py-8 space-y-4">
        <p className="text-slate-500 text-sm">Nothing to review yet.</p>
      </section>
    );
  }

  const { perPerson } = computeTotals(items, assignments, parsed, payers);

  const unresolvedCount = items.filter((item) => {
    const assignment = assignments[item.id];
    if (claimMode === 'payers' && tickedOf(assignment).length === 0) return false;
    return !isItemResolved(item, assignment);
  }).length;
  // Field problems do NOT disable Confirm: a disabled button can't be
  // clicked, so it could never tell the customer *which* item to fix.
  // handleConfirm blocks instead, shows the messages and moves focus.
  const itemProblems = validateItems(items);
  const problemsById = new Map(itemProblems.map((p) => [p.itemId, p.problems]));
  // A roster problem does not disable Confirm either: tapping it opens the
  // People panel, shows the messages and focuses the first bad name.
  const rosterCheck = validateRoster(payers);
  const rosterValid = rosterCheck.valid;
  // While two people share a name, their per-item controls (and the item-wide
  // mode switches) stay off, so nothing can attach to the wrong person.
  const clashRows = new Set(rosterCheck.duplicateIndices);
  const hasClash = clashRows.size > 0;
  const onlyClash =
    hasClash && !rosterCheck.hostNameBlank && rosterCheck.blankIndices.length === 0 && rosterCheck.tooLongIndices.length === 0;
  const readyExceptRoster = items.length > 0 && unresolvedCount === 0;
  const canConfirm = readyExceptRoster && rosterValid;

  const itemSumCents = items.reduce((sum, item) => sum + toCents(item.line_total), 0);
  const statedSubtotalCents = toCents(parsed.subtotal);
  const mismatchCents = itemSumCents - statedSubtotalCents;
  const showMismatch = items.length > 0 && Math.abs(mismatchCents) >= 2;

  // Radix Accordion.Root, controlled: `value` is the array of currently-open
  // item ids, `onValueChange` fires with the NEXT array Radix wants to
  // apply after a trigger was activated. We inspect the diff to find which
  // single id is opening or closing (Radix only ever changes one id per
  // trigger activation), and reject the change — leaving `expandedIds`
  // untouched, so Radix's controlled `value` snaps the row back open — when
  // closing would leave an unresolved manual-mode row hidden.
  function handleAccordionChange(nextValue) {
    const current = expandedIds;
    const nextSet = new Set(nextValue);
    const closingId = [...current].find((id) => !nextSet.has(id));
    const openingId = nextValue.find((id) => !current.has(id));

    if (closingId) {
      const item = items.find((i) => i.id === closingId);
      const assignment = assignments[closingId];
      if (item && !isItemResolved(item, assignment) && assignment?.mode === 'manual') {
        setBlockedIds((prev) => new Set(prev).add(closingId));
        focusFirstUnresolvedInput(closingId);
        return;
      }
    }

    setExpandedIds(nextSet);
    const changedId = openingId ?? closingId;
    if (changedId) {
      setBlockedIds((prev) => {
        if (!prev.has(changedId)) return prev;
        const next = new Set(prev);
        next.delete(changedId);
        return next;
      });
    }
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

  function handleManualValueBlur() {
    setMoneySnapTick((n) => n + 1);
  }

  function handleConfirm() {
    setMoneySnapTick((n) => n + 1);
    if (!rosterValid) {
      setPeopleOpen(true);
      setShowRosterErrors(true);
      setRosterFocusTick((n) => n + 1);
      return;
    }
    if (items.length === 0) {
      setValidationError('Every item needs a name, and there must be at least one item.');
      return;
    }
    if (itemProblems.length > 0) {
      const first = itemProblems[0];
      setShowItemErrors(true);
      setValidationError('');
      // Open every offending row so its messages are visible, then focus
      // the first offending field.
      setExpandedIds((prev) => {
        const next = new Set(prev);
        itemProblems.forEach((p) => next.add(p.itemId));
        return next;
      });
      setPendingFocus({ itemId: first.itemId, field: first.problems[0].field });
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
      <div className="sticky top-0 z-10 bg-slate-50 pb-2 -mx-4 px-4 pt-2 space-y-2">
        {parsed.merchant_name && <h2 className="text-2xl font-bold">{parsed.merchant_name}</h2>}
        {parsed.receipt_date && <p className="text-xs text-slate-500">{parsed.receipt_date}</p>}
        <h3 className="text-xl font-bold">Check the items</h3>
        <p className="text-slate-600 text-sm" data-testid="trust-copy">
          {TRUST_COPY}
        </p>
      </div>

      <ReviewPeopleRow
        open={peopleOpen}
        onOpenChange={setPeopleOpen}
        showErrors={showRosterErrors}
        onShowErrors={setShowRosterErrors}
        onBlocked={() => setRosterFocusTick((n) => n + 1)}
        focusTick={rosterFocusTick}
      />

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

      <Accordion.Root
        type="multiple"
        value={[...expandedIds]}
        onValueChange={handleAccordionChange}
        className="space-y-3"
      >
        {items.map((item) => {
          const assignment = assignments[item.id];
          const expanded = expandedIds.has(item.id);
          const blocked = blockedIds.has(item.id);
          const mode = assignment && !Array.isArray(assignment) ? assignment.mode : 'equal';
          const ticked = tickedOf(assignment);
          const unit = assignment && !Array.isArray(assignment) ? assignment.manual.unit : 'RM';
          const remaining = manualItemRemainingCents(item, assignment);
          const fieldProblems = showItemErrors ? problemsById.get(item.id) || [] : [];
          const bad = (field) => fieldProblems.some((p) => p.field === field);
          const errId = (field) => `${item.id}-${field}-error`;
          const a11y = (field) =>
            bad(field) ? { 'aria-invalid': true, 'aria-describedby': errId(field) } : {};

          return (
            <Accordion.Item key={item.id} value={item.id} asChild>
              <motion.div layout className="assign-item-row space-y-2">
                {/* Collapsed summary row */}
                <Accordion.Header>
                  <Accordion.Trigger asChild>
                    <motion.button
                      type="button"
                      whileTap={TAP_SCALE}
                      transition={TAP_TRANSITION}
                      className="w-full flex justify-between items-start gap-3 text-left"
                    >
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{item.name || '(unnamed item)'}</span>
                        {showItemErrors && problemsById.has(item.id) ? (
                          <span className="block text-xs text-red-700">Needs fixing</span>
                        ) : (
                          <span className="block text-xs text-slate-500">
                            {assignmentSummaryText(item, assignment, payers.length, claimMode)}
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatRM(item.line_total)}</span>
                    </motion.button>
                  </Accordion.Trigger>
                </Accordion.Header>

              <Accordion.Content>
                {expanded && (
                  <div className="space-y-3 pt-2 border-t border-slate-100">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={item.name}
                        placeholder="Item name"
                        onChange={(e) => updateItemField(item.id, 'name', e.target.value)}
                        className="flex-1 rounded-md border-slate-300 text-sm min-h-[48px]"
                        aria-label="Item name"
                        ref={(el) => registerFieldRef(item.id, 'name', el)}
                        {...a11y('name')}
                      />
                      <select
                        value={item.category}
                        onChange={(e) => updateItemField(item.id, 'category', e.target.value)}
                        className="rounded-md border-slate-300 text-sm min-h-[48px]"
                        aria-label="Category"
                        ref={(el) => registerFieldRef(item.id, 'category', el)}
                        {...a11y('category')}
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
                          ref={(el) => registerFieldRef(item.id, 'qty', el)}
                          {...a11y('qty')}
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
                          ref={(el) => registerFieldRef(item.id, 'unit_price', el)}
                          {...a11y('unit_price')}
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
                          ref={(el) => registerFieldRef(item.id, 'line_total', el)}
                          {...a11y('line_total')}
                        />
                      </label>
                    </div>
                    {fieldProblems.length > 0 && (
                      <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-xs p-2 space-y-1">
                        {fieldProblems.map((p) => (
                          <p key={p.field} id={errId(p.field)}>
                            {p.message}
                          </p>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="text-xs text-red-500 min-h-[48px] px-2"
                    >
                      Remove item
                    </button>

                    {hasClash && (
                      <p className="text-sm text-slate-600" data-testid="name-clash-note">
                        Fix the matching names first.
                      </p>
                    )}
                    <ToggleGroup.Root
                      type="single"
                      value={mode}
                      disabled={hasClash}
                      onValueChange={(next) => {
                        if (next) setItemMode(item.id, next);
                      }}
                      className="flex rounded-md border border-slate-300 overflow-hidden text-xs font-medium"
                    >
                      <ToggleGroup.Item value="equal" asChild>
                        <motion.button
                          whileTap={TAP_SCALE}
                          transition={TAP_TRANSITION}
                          className={`flex-1 min-h-[48px] ${mode === 'equal' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                        >
                          Equal split
                        </motion.button>
                      </ToggleGroup.Item>
                      <ToggleGroup.Item value="manual" asChild>
                        <motion.button
                          whileTap={TAP_SCALE}
                          transition={TAP_TRANSITION}
                          className={`flex-1 min-h-[48px] ${mode === 'manual' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                        >
                          Set amounts
                        </motion.button>
                      </ToggleGroup.Item>
                    </ToggleGroup.Root>

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
                              <AnimatedMoney
                                cents={Math.abs(remaining)}
                                snapTick={moneySnapTick}
                                locked
                              />{' '}
                              {remaining > 0 ? 'still to allocate' : 'over'}
                            </div>
                            <div>
                              Shares must total{' '}
                              <AnimatedMoney cents={toCents(item.line_total)} snapTick={moneySnapTick} locked />.
                            </div>
                          </>
                        ) : remaining === 0 ? (
                          'Fully allocated ✓'
                        ) : (
                          <>
                            <AnimatedMoney cents={Math.abs(remaining)} snapTick={moneySnapTick} locked />{' '}
                            {remaining > 0 ? 'left to allocate' : 'over'}
                          </>
                        )}
                      </div>
                    )}

                    {mode === 'manual' && (
                      <ToggleGroup.Root
                        type="single"
                        value={unit}
                        disabled={hasClash}
                        onValueChange={(next) => {
                          if (next) setItemManualUnit(item.id, next, item.line_total);
                        }}
                        className="flex rounded-full border border-slate-300 overflow-hidden text-xs font-medium w-fit"
                      >
                        <ToggleGroup.Item
                          value="RM"
                          className={`px-3 min-h-[48px] ${unit === 'RM' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                        >
                          RM
                        </ToggleGroup.Item>
                        <ToggleGroup.Item
                          value="%"
                          className={`px-3 min-h-[48px] ${unit === '%' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
                        >
                          %
                        </ToggleGroup.Item>
                      </ToggleGroup.Root>
                    )}

                    <div className="space-y-2 text-sm">
                      {payers.map((name, personIndex) => {
                        const rowLocked = clashRows.has(personIndex);
                        const isTicked = ticked.includes(name);
                        const value =
                          mode === 'manual' && assignment && !Array.isArray(assignment)
                            ? assignment.manual.values[name]
                            : undefined;
                        return (
                          <motion.div
                            key={personIndex}
                            whileTap={TAP_SCALE}
                            transition={TAP_TRANSITION}
                            className="flex items-center gap-2 min-h-[48px]"
                          >
                            <input
                              type="checkbox"
                              checked={isTicked}
                              disabled={rowLocked}
                              onChange={(e) => setItemAssignment(item.id, name, e.target.checked)}
                              className="h-5 w-5"
                              aria-label={`Include ${name}`}
                            />
                            <span className="flex-1">{name}</span>
                            {mode === 'manual' && isTicked && (
                              <input
                                type="text"
                                inputMode="decimal"
                                ref={(el) => registerManualInputRef(item.id, name, el)}
                                value={value?.text ?? ''}
                                onChange={(e) => handleManualValueChange(item, name, e.target.value)}
                                onBlur={handleManualValueBlur}
                                disabled={rowLocked}
                                placeholder={unit === '%' ? '0' : '0.00'}
                                className="w-20 rounded-md border-slate-300 text-sm text-right tabular-nums min-h-[48px]"
                                aria-label={`${name}'s ${unit === '%' ? 'percentage' : 'amount'} for ${item.name || 'this item'}`}
                              />
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                )}
                </Accordion.Content>
              </motion.div>
            </Accordion.Item>
          );
        })}
      </Accordion.Root>

      <motion.button
        type="button"
        onClick={addItem}
        whileTap={TAP_SCALE}
        transition={TAP_TRANSITION}
        className="w-full rounded-lg border border-dashed border-slate-300 text-slate-600 text-sm py-3 min-h-[48px]"
      >
        + Add missing item
      </motion.button>

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
          {payers.map((name, personIndex) => (
            <div key={personIndex} className="flex justify-between">
              <span>{name}</span>
              <AnimatedMoney
                className="font-semibold"
                cents={Math.round(perPerson[name]?.totalCents ?? 0)}
                snapTick={moneySnapTick}
              />
            </div>
          ))}
        </div>
      </div>

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

      {showItemErrors && itemProblems.length > 0 && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {itemProblems.length === 1
            ? 'One item needs fixing before you can continue: '
            : `${itemProblems.length} items need fixing before you can continue. First: `}
          {itemProblems[0].problems[0].message}
        </div>
      )}

      {validationError && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {validationError}
        </div>
      )}

      <motion.button
        type="button"
        onClick={handleConfirm}
        disabled={!readyExceptRoster}
        whileTap={readyExceptRoster ? TAP_SCALE : undefined}
        transition={TAP_TRANSITION}
        className="w-full rounded-lg bg-amber-500 disabled:bg-slate-300 text-slate-900 disabled:text-slate-700 font-semibold py-3 min-h-[48px]"
      >
        Confirm and continue
      </motion.button>
      {!rosterValid && (
        <p className="text-sm text-slate-600 text-center" data-testid="roster-block-reason">
          {onlyClash ? 'Two people have the same name.' : 'Finish the people list first.'}
        </p>
      )}
    </section>
  );
}
