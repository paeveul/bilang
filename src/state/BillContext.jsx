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
// creating, share, error, payer. 'review' is intentionally NOT built by
// this pass — see src/screens/ReviewScreen.jsx's header comment — so it
// stays the same placeholder Step 2 already established.
import { createContext, useCallback, useContext, useMemo, useReducer } from 'react';

const initialState = {
  screen: 'landing',
  receiptImageBase64: null,
  receiptMimeType: null,
  parsed: null, // {items: [{id, name, category, qty, unit_price, line_total}], subtotal, service_charge, tax, grand_total}
  payers: ['Me'],
  assignments: {}, // itemId -> string[] of payer names
  ownerPaymentHandle: '',
  errorMessage: '',
  shareUrl: '',
};

let itemIdCounter = 0;
function nextItemId() {
  itemIdCounter += 1;
  return `item-${itemIdCounter}`;
}

function reducer(state, action) {
  switch (action.type) {
    case 'GO_TO_SCREEN':
      return { ...state, screen: action.screen };
    case 'SET_RECEIPT':
      return { ...state, receiptImageBase64: action.base64, receiptMimeType: action.mimeType };
    case 'CLEAR_RECEIPT_IMAGE':
      // The receipt image has done its one job (the single parseReceipt()
      // call) — drop it from memory now, matching js/app.js's runParse().
      return { ...state, receiptImageBase64: null };
    case 'SET_PARSED': {
      const items = (action.parsed.items || []).map((item) => ({ id: nextItemId(), ...item }));
      return { ...state, parsed: { ...action.parsed, items } };
    }
    case 'ADD_PAYER': {
      if (!action.name || state.payers.includes(action.name)) return state;
      return { ...state, payers: [...state.payers, action.name] };
    }
    case 'REMOVE_PAYER': {
      if (state.payers.length <= 1) return state; // always keep at least one payer
      const assignments = { ...state.assignments };
      Object.keys(assignments).forEach((itemId) => {
        assignments[itemId] = (assignments[itemId] || []).filter((p) => p !== action.name);
      });
      return { ...state, payers: state.payers.filter((p) => p !== action.name), assignments };
    }
    case 'SET_ITEM_ASSIGNMENT': {
      const current = state.assignments[action.itemId] || [];
      const next = action.checked
        ? current.includes(action.name) ? current : [...current, action.name]
        : current.filter((p) => p !== action.name);
      return { ...state, assignments: { ...state.assignments, [action.itemId]: next } };
    }
    case 'ENSURE_ITEM_DEFAULT_ASSIGNMENT': {
      if (state.assignments[action.itemId]) return state;
      return { ...state, assignments: { ...state.assignments, [action.itemId]: [...state.payers] } };
    }
    case 'SET_PAYMENT_HANDLE':
      return { ...state, ownerPaymentHandle: action.value };
    case 'SET_SHARE_URL':
      return { ...state, shareUrl: action.url };
    case 'SET_ERROR':
      return { ...state, errorMessage: action.message, screen: 'error' };
    case 'RESET':
      return { ...initialState, payers: ['Me'] };
    default:
      return state;
  }
}

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
// through a real parseReceipt() call.
export const __test__ = { nextItemId, reducer, initialState };
