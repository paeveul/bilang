// src/state/BillContext.jsx — Item 22 Steps 5-7: shared creator-flow state.
//
// Mirrors js/app.js's module-level `state` object (Step 2's App.jsx did not
// need this yet since every screen was a stub). One useReducer + context,
// not a data-fetching library (F9) — this holds client-only UI/session
// state, not server data; the only server calls remain parseReceipt(),
// createSplit(), getSplit() from js/api-client.js, called directly from
// the screen that needs them, per the unchanged js/*-client.js convention.
//
// Screen names and their meaning are unchanged from index.html's existing
// data-screen values: landing, capture, parsing, review, assign, payment,
// creating, share, error, payer. 'review' is now Item 22 Step 8's combined
// correction + assignment screen (src/screens/ReviewScreen.jsx) — see that
// file's header comment. 'assign' is retired: its Step 7 tick-list logic
// was absorbed into ReviewScreen.jsx per Alex's 2026-09-22 scope decision
// (bilang-mvp1-implementation-plans.md §22.7 Q1 resolution addendum,
// bilang-pm-tracker.md's Step 8 row) — the state machine no longer visits
// 'assign' as its own screen, though the name is left in SCREEN_NAMES'
// historical comment trail in App.jsx rather than silently erased.
//
// The actual reducer/state/action-shape logic lives in ./bill-reducer.js —
// a plain .js file with no JSX in it, split out specifically so it's
// directly testable under Node's built-in test runner with no JSX
// transform (same reason src/screens/payer-item-row.js exists as its own
// file — see that file's header comment for the precedent). This file adds
// only the React context/provider/hooks wiring around that logic.
import { createContext, useContext, useMemo, useReducer } from 'react';
import { reducer, initialState, defaultAssignment, nextItemId } from './bill-reducer.js';

const BillStateContext = createContext(null);
const BillDispatchContext = createContext(null);

export function BillProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const actions = useMemo(
    () => ({
      goToScreen: (screen) => dispatch({ type: 'GO_TO_SCREEN', screen }),
      setReceipt: (base64, mimeType) => dispatch({ type: 'SET_RECEIPT', base64, mimeType }),
      clearReceiptImage: () => dispatch({ type: 'CLEAR_RECEIPT_IMAGE' }),
      setParsed: (parsed) => dispatch({ type: 'SET_PARSED', parsed }),
      addPayer: (name) => dispatch({ type: 'ADD_PAYER', name }),
      removePayer: (name) => dispatch({ type: 'REMOVE_PAYER', name }),
      setItemAssignment: (itemId, name, checked) =>
        dispatch({ type: 'SET_ITEM_ASSIGNMENT', itemId, name, checked }),
      ensureItemDefaultAssignment: (itemId) => dispatch({ type: 'ENSURE_ITEM_DEFAULT_ASSIGNMENT', itemId }),
      setItemMode: (itemId, mode) => dispatch({ type: 'SET_ITEM_MODE', itemId, mode }),
      setItemManualUnit: (itemId, unit, lineTotal) =>
        dispatch({ type: 'SET_ITEM_MANUAL_UNIT', itemId, unit, lineTotal }),
      setItemManualValue: (itemId, name, text, cents) =>
        dispatch({ type: 'SET_ITEM_MANUAL_VALUE', itemId, name, text, cents }),
      updateItemField: (itemId, field, value) => dispatch({ type: 'UPDATE_ITEM_FIELD', itemId, field, value }),
      addItem: () => dispatch({ type: 'ADD_ITEM' }),
      removeItem: (itemId) => dispatch({ type: 'REMOVE_ITEM', itemId }),
      updateBillField: (field, value) => dispatch({ type: 'UPDATE_BILL_FIELD', field, value }),
      setPaymentHandle: (value) => dispatch({ type: 'SET_PAYMENT_HANDLE', value }),
      setShareUrl: (url) => dispatch({ type: 'SET_SHARE_URL', url }),
      setError: (message) => dispatch({ type: 'SET_ERROR', message }),
      reset: () => dispatch({ type: 'RESET' }),
    }),
    []
  );

  return (
    <BillStateContext.Provider value={state}>
      <BillDispatchContext.Provider value={actions}>{children}</BillDispatchContext.Provider>
    </BillStateContext.Provider>
  );
}

export function useBillState() {
  const ctx = useContext(BillStateContext);
  if (!ctx) throw new Error('useBillState() called outside <BillProvider>');
  return ctx;
}

export function useBillActions() {
  const ctx = useContext(BillDispatchContext);
  if (!ctx) throw new Error('useBillActions() called outside <BillProvider>');
  return ctx;
}

// Exported for local testing only (mirrors router.jsx's resolveForTest
// precedent) — lets a test seed deterministic item ids without going
// through a real parseReceipt() call. Prefer importing directly from
// ./bill-reducer.js in a .test.mjs file (no JSX transform needed there);
// this re-export exists so code already importing __test__ from this
// module keeps working.
export const __test__ = { nextItemId, reducer, initialState, defaultAssignment };
