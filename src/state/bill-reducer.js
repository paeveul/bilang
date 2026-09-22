// src/state/bill-reducer.js — the state/action logic behind BillContext.jsx,
// extracted into a plain .js file (no JSX) on purpose so it can be tested
// directly under Node's built-in test runner without a JSX transform — same
// reason src/screens/payer-item-row.js was split out of PayerScreen.jsx in
// Item 22 Step 6 (see that file's header comment for the precedent).
// BillContext.jsx imports everything from here and adds only the React
// context/provider/hooks wiring around it.
import { centsToPercent, fromCents } from '../../js/totals.js';

export const initialState = {
  screen: 'landing',
  receiptImageBase64: null,
  receiptMimeType: null,
  parsed: null, // {items: [{id, name, category, qty, unit_price, line_total}], subtotal, service_charge, tax, grand_total}
  payers: ['Me'],
  // itemId -> assignment, consumed directly by js/totals.js's
  // computeTotals() (see that file's own JSDoc for the authoritative shape
  // description). Always:
  //   { mode: 'equal' | 'manual', equal: string[], manual: { unit: 'RM'|'%', values: {name: {text, cents}} } }
  // `equal` doubles as the single shared "who's ticked for this item"
  // roster for BOTH modes (§5.1.1 point 1: "switching modes discards
  // nothing already ticked ... on the other mode" — a name ticked under
  // Equal split arrives pre-ticked under Set amounts because they read the
  // same array, not a copy of it). Only `computeTotals()`'s equal-split
  // branch treats `equal` as authoritative money data; in manual mode it's
  // purely the tick roster the manual editor renders rows for.
  // `manual.values` only ever holds entries for currently-ticked names, and
  // is reset to {} every time `mode` changes (§5.1.1 point 1: reverting
  // "discards the typed values ... but keeps the tick state" — the tick
  // state is `equal`, which a mode switch never touches).
  assignments: {},
  ownerPaymentHandle: '',
  errorMessage: '',
  shareUrl: '',
};

export function defaultAssignment(payers) {
  return { mode: 'equal', equal: [...payers], manual: { unit: 'RM', values: {} } };
}

let itemIdCounter = 0;
export function nextItemId() {
  itemIdCounter += 1;
  return `item-${itemIdCounter}`;
}

export function reducer(state, action) {
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
        const a = assignments[itemId];
        if (!a) return;
        if (Array.isArray(a)) {
          // Legacy plain-array shape (pre-Step-8 default) — kept working
          // for defensiveness, though ENSURE_ITEM_DEFAULT_ASSIGNMENT no
          // longer creates this shape itself.
          assignments[itemId] = a.filter((p) => p !== action.name);
          return;
        }
        const equal = a.equal.filter((p) => p !== action.name);
        const values = { ...a.manual.values };
        delete values[action.name];
        assignments[itemId] = { ...a, equal, manual: { ...a.manual, values } };
      });
      return { ...state, payers: state.payers.filter((p) => p !== action.name), assignments };
    }
    // Ticks/unticks a payer for an item — the single shared roster used by
    // both Equal split and Set amounts (§5.1.1 point 1). Un-ticking also
    // clears any manual value that name had typed for this item (§5.1.1
    // point 7, "edge cases": "un-ticking clears that row's typed value ...
    // immediately updates the live indicator — un-ticking is a declaration
    // that person isn't in this item at all").
    case 'SET_ITEM_ASSIGNMENT': {
      const current = state.assignments[action.itemId] || defaultAssignment(state.payers);
      const currentEqual = Array.isArray(current) ? current : current.equal;
      const nextEqual = action.checked
        ? currentEqual.includes(action.name)
          ? currentEqual
          : [...currentEqual, action.name]
        : currentEqual.filter((p) => p !== action.name);

      const base = Array.isArray(current) ? defaultAssignment(state.payers) : current;
      const values = { ...base.manual.values };
      if (!action.checked) delete values[action.name];

      return {
        ...state,
        assignments: {
          ...state.assignments,
          [action.itemId]: { ...base, equal: nextEqual, manual: { ...base.manual, values } },
        },
      };
    }
    case 'ENSURE_ITEM_DEFAULT_ASSIGNMENT': {
      if (state.assignments[action.itemId]) return state;
      return {
        ...state,
        assignments: { ...state.assignments, [action.itemId]: defaultAssignment(state.payers) },
      };
    }
    // §5.1.1 point 1 — the mode switcher. Switching to 'manual' opens with
    // blank values (point 293: fields start blank, never pre-filled with an
    // equal-split starting value). Switching away from 'manual' discards
    // the typed values but keeps `equal` (the tick roster) untouched — "the
    // typed values ... belong to the mode that created them," the tick
    // state does not.
    case 'SET_ITEM_MODE': {
      const current = state.assignments[action.itemId] || defaultAssignment(state.payers);
      const base = Array.isArray(current) ? defaultAssignment(state.payers) : current;
      if (base.mode === action.mode) return state;
      return {
        ...state,
        assignments: {
          ...state.assignments,
          [action.itemId]: { ...base, mode: action.mode, manual: { ...base.manual, values: {} } },
        },
      };
    }
    // §5.1.1 point 2 — the RM/% toggle. Applies to every ticked row in this
    // item's editor at once (never mixed per-row). Converts existing typed
    // values live rather than discarding them (point 316's "Switching to %
    // mid-entry with RM values already typed: values convert live").
    // `action.lineTotal` is the item's RM line_total, needed to resolve
    // percent<->cents (js/totals.js's percentToCents/centsToPercent) — the
    // reducer stays a pure function of its arguments, so the screen passes
    // this in rather than the reducer reaching into `state.parsed` itself.
    case 'SET_ITEM_MANUAL_UNIT': {
      const current = state.assignments[action.itemId];
      if (!current || Array.isArray(current) || current.manual.unit === action.unit) return state;
      const values = {};
      for (const [name, v] of Object.entries(current.manual.values)) {
        const text =
          action.unit === '%' ? String(centsToPercent(v.cents, action.lineTotal)) : String(fromCents(v.cents));
        values[name] = { text, cents: v.cents }; // cents (the canonical value) never changes on a unit switch
      }
      return {
        ...state,
        assignments: {
          ...state.assignments,
          [action.itemId]: { ...current, manual: { unit: action.unit, values } },
        },
      };
    }
    // §5.1.1 point 2/7 — a manual value field's typed text. `action.cents`
    // is the already-resolved integer-cents value (the screen computes it
    // via toCents() or percentToCents() before dispatching, per those
    // functions' own "canonical stored value" contract) — the reducer never
    // parses money text itself, to keep exactly one place doing that math.
    case 'SET_ITEM_MANUAL_VALUE': {
      const current = state.assignments[action.itemId] || defaultAssignment(state.payers);
      const base = Array.isArray(current) ? defaultAssignment(state.payers) : current;
      const values = {
        ...base.manual.values,
        [action.name]: { text: action.text, cents: action.cents },
      };
      return {
        ...state,
        assignments: { ...state.assignments, [action.itemId]: { ...base, manual: { ...base.manual, values } } },
      };
    }
    // --- Item correction (§5.1, name/qty/unit_price/category/line_total,
    // add/remove item, bill-level totals) — porting js/app.js's
    // buildReviewItemRow()/collectReviewedItems()/bindReview() behaviour to
    // controlled React state rather than reading the DOM at confirm-time.
    case 'UPDATE_ITEM_FIELD': {
      if (!state.parsed) return state;
      const items = state.parsed.items.map((item) =>
        item.id === action.itemId ? { ...item, [action.field]: action.value } : item
      );
      return { ...state, parsed: { ...state.parsed, items } };
    }
    case 'ADD_ITEM': {
      if (!state.parsed) return state;
      const newItem = { id: nextItemId(), name: '', category: 'food', qty: 1, unit_price: 0, line_total: 0 };
      return { ...state, parsed: { ...state.parsed, items: [...state.parsed.items, newItem] } };
    }
    case 'REMOVE_ITEM': {
      if (!state.parsed) return state;
      const items = state.parsed.items.filter((item) => item.id !== action.itemId);
      const assignments = { ...state.assignments };
      delete assignments[action.itemId];
      return { ...state, parsed: { ...state.parsed, items }, assignments };
    }
    case 'UPDATE_BILL_FIELD':
      if (!state.parsed) return state;
      return { ...state, parsed: { ...state.parsed, [action.field]: action.value } };
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
