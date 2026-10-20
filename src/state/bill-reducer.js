import { centsToPercent, fromCents } from '../../js/totals.js';

export const initialState = {
  screen: 'landing',
  receiptImageBase64: null,
  receiptMimeType: null,
  parsed: null, // {items: [{id, name, category, qty, unit_price, line_total}], subtotal, service_charge, tax, grand_total}
  payers: ['Me'],
  claimMode: 'host',
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
    case 'RENAME_PAYER': {
      const oldName = state.payers[action.index];
      if (oldName === undefined || oldName === action.name) return state;
      const payers = state.payers.map((p, i) => (i === action.index ? action.name : p));
      const assignments = { ...state.assignments };
      Object.keys(assignments).forEach((itemId) => {
        const a = assignments[itemId];
        if (!a) return;
        if (Array.isArray(a)) {
          assignments[itemId] = a.map((p) => (p === oldName ? action.name : p));
          return;
        }
        const equal = a.equal.map((p) => (p === oldName ? action.name : p));
        const values = { ...a.manual.values };
        if (Object.prototype.hasOwnProperty.call(values, oldName)) {
          values[action.name] = values[oldName];
          delete values[oldName];
        }
        assignments[itemId] = { ...a, equal, manual: { ...a.manual, values } };
      });
      return { ...state, payers, assignments };
    }
    case 'SET_CLAIM_MODE':
      if (state.claimMode === action.mode) return state;
      return { ...state, claimMode: action.mode };
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
      return { ...initialState, payers: ['Me'], claimMode: 'host' };
    default:
      return state;
  }
}
