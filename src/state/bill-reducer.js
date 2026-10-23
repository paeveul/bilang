import { centsToPercent, fromCents, lineTotalFromQty, toCents } from '../../js/totals.js';
import { sameName } from '../../api/_lib/name-rule.js';
import { moneySignature } from './money-signature.js';

export const initialState = {
  screen: 'landing',
  receiptImageBase64: null,
  receiptMimeType: null,
  parsed: null, // {items: [{id, name, category, qty, unit_price, line_total}], subtotal, service_charge, tax, grand_total}
  payers: ['Me'],
  claimMode: 'host',
  assignments: {},
  // Assignments are keyed by person name. While two people briefly share a
  // name mid-edit, a renamed person keeps their old name here (index ->
  // name still used inside `assignments`) until the roster is unambiguous
  // again, so nobody's ticks are merged or lost.
  nameKeyByIndex: {},
  // What the screen shows beside a line price the host's edit changed: per
  // item id 'calc' (worked out from qty x price), 'rounded' (the product was
  // not a whole sen and was settled to the nearest sen) or 'kept' (the host
  // typed the price). Kept apart from `parsed` so none of it is ever sent.
  derived: { lines: {}, subtotalMoved: false },
  // The host's tick that the screen matches the paper receipt: the money
  // fingerprint and the difference it was ticked at, or null. It clears itself
  // on any edit that changes the fingerprint (see reducer below).
  gapAck: null,
  // True after an edit cleared a tick, so the screen can say so.
  gapAckCleared: false,
  // Set when a save was refused because the figures did not add up.
  saveError: null,
  ownerPaymentHandle: '',
  errorMessage: '',
  shareUrl: '',
};

export function defaultAssignment(payers) {
  return { mode: 'equal', equal: [...payers], manual: { unit: 'RM', values: {} } };
}

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

/** The name each person is stored under inside `assignments`, by roster index. */
export function assignmentKeys(state) {
  return state.payers.map((name, i) => (hasOwn(state.nameKeyByIndex, i) ? state.nameKeyByIndex[i] : name));
}

function sameMembers(list, keys) {
  if (list.length !== keys.length) return false;
  const set = new Set(list);
  return set.size === keys.length && keys.every((k) => set.has(k));
}

/**
 * True when an item still sits on the untouched default: shared equally by
 * everyone on the roster, with no hand-set amounts. A missing assignment
 * counts as untouched (it is created as the default on demand).
 */
export function isDefaultAssignment(assignment, keys) {
  if (assignment === undefined || assignment === null) return true;
  if (Array.isArray(assignment)) return sameMembers(assignment, keys);
  return (
    assignment.mode === 'equal' &&
    Object.keys(assignment.manual?.values || {}).length === 0 &&
    sameMembers(assignment.equal || [], keys)
  );
}

/** True when the host has changed at least one item away from the default. */
export function hasHandAssignedItems(state) {
  const items = state.parsed?.items ?? [];
  const keys = assignmentKeys(state);
  return items.some((item) => !isDefaultAssignment(state.assignments[item.id], keys));
}

function hasNoAllocation(assignment) {
  if (assignment === undefined || assignment === null) return true;
  if (Array.isArray(assignment)) return assignment.length === 0;
  return (assignment.equal || []).length === 0 && Object.keys(assignment.manual?.values || {}).length === 0;
}

/** How many items currently have nobody on them. */
export function countUnallocatedItems(state) {
  const items = state.parsed?.items ?? [];
  return items.filter((item) => hasNoAllocation(state.assignments[item.id])).length;
}

// Items nobody is on yet get the default (everyone, equal split). Items that
// carry any allocation are left exactly as they are.
function fillUnallocatedWithDefault(state) {
  const items = state.parsed?.items ?? [];
  const keys = assignmentKeys(state);
  const assignments = { ...state.assignments };
  items.forEach((item) => {
    if (hasNoAllocation(assignments[item.id])) assignments[item.id] = defaultAssignment(keys);
  });
  return assignments;
}

// Simultaneous rename of assignment keys ({from: to, ...}) so swapped names
// cannot collide with each other part-way through.
export function rekeyAssignments(assignments, map) {
  const rename = (name) => (hasOwn(map, name) ? map[name] : name);
  const next = {};
  Object.keys(assignments).forEach((itemId) => {
    const a = assignments[itemId];
    if (!a) {
      next[itemId] = a;
      return;
    }
    if (Array.isArray(a)) {
      next[itemId] = a.map(rename);
      return;
    }
    const values = {};
    Object.keys(a.manual.values).forEach((name) => {
      values[rename(name)] = a.manual.values[name];
    });
    next[itemId] = { ...a, equal: a.equal.map(rename), manual: { ...a.manual, values } };
  });
  return next;
}

function stripKeyFromAssignments(assignments, key) {
  const next = { ...assignments };
  Object.keys(next).forEach((itemId) => {
    const a = next[itemId];
    if (!a) return;
    if (Array.isArray(a)) {
      next[itemId] = a.filter((p) => p !== key);
      return;
    }
    const values = { ...a.manual.values };
    delete values[key];
    next[itemId] = { ...a, equal: a.equal.filter((p) => p !== key), manual: { ...a.manual, values } };
  });
  return next;
}

// Once every name on the roster is different again, stored keys must equal
// the displayed names: rename every held key to its person's current name
// (all at once) and drop the held-key map. While a clash remains, leave the
// keys alone. Run after any change to the roster, so no path can leave ticks
// under a name that is no longer on it.
function settleKeys(state) {
  if (Object.keys(state.nameKeyByIndex || {}).length === 0) return state;
  if (new Set(state.payers).size !== state.payers.length) return state;
  const keys = assignmentKeys(state);
  const map = {};
  state.payers.forEach((name, i) => {
    if (keys[i] !== name) map[keys[i]] = name;
  });
  return { ...state, nameKeyByIndex: {}, assignments: rekeyAssignments(state.assignments, map) };
}

let itemIdCounter = 0;
export function nextItemId() {
  itemIdCounter += 1;
  return `item-${itemIdCounter}`;
}

/**
 * Wraps the main reducer: a tick lasts only while the money fingerprint is the
 * one it was made at, and a refused-save message lasts only until the next
 * change to the money. Reassigning who ordered an item changes neither.
 */
export function reducer(state, action) {
  const next = baseReducer(state, action);
  if (next === state || !next.parsed) return next;
  if (!next.gapAck && !next.saveError) return next;
  const signature = moneySignature(next.parsed);
  let out = next;
  if (out.gapAck && out.gapAck.signature !== signature) {
    out = { ...out, gapAck: null, gapAckCleared: true };
  }
  if (out.saveError && state.parsed && moneySignature(state.parsed) !== signature) {
    out = { ...out, saveError: null };
  }
  return out;
}

function baseReducer(state, action) {
  switch (action.type) {
    case 'SET_GAP_ACK':
      return {
        ...state,
        gapAck: { signature: action.signature, gapCents: action.gapCents },
        gapAckCleared: false,
        saveError: null,
      };
    case 'CLEAR_GAP_ACK':
      return { ...state, gapAck: null, gapAckCleared: false };
    case 'SET_SAVE_ERROR':
      // A refused save also clears the tick: the server's figure is the truth.
      return { ...state, saveError: action.code, gapAck: null, gapAckCleared: false };
    case 'CLEAR_SAVE_ERROR':
      return state.saveError ? { ...state, saveError: null } : state;
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
      // Keep what the scan read for the rounding line, so the screen can tell
      // when the host changed it (and offer Undo). A parse without the new
      // fields (an older shape) has no scanned rounding to compare with.
      const scanned =
        action.parsed.rounding !== undefined || action.parsed.discount !== undefined
          ? { scanned_rounding: Number.isFinite(action.parsed.rounding) ? action.parsed.rounding : 0 }
          : {};
      return {
        ...state,
        parsed: { ...action.parsed, ...scanned, items },
        derived: { lines: {}, subtotalMoved: false },
        gapAck: null,
        gapAckCleared: false,
        saveError: null,
      };
    }
    case 'ADD_PAYER': {
      const keys = assignmentKeys(state);
      if (!action.name || state.payers.some((p) => sameName(p, action.name)) || keys.includes(action.name)) return state;
      const payers = [...state.payers, action.name];
      if (state.claimMode !== 'host') return { ...state, payers };
      // Host assigns: the new person joins every item still on the default
      // split. Items the host changed by hand are left alone.
      const items = state.parsed?.items ?? [];
      const assignments = { ...state.assignments };
      items.forEach((item) => {
        const a = assignments[item.id];
        if (a === undefined || a === null) {
          assignments[item.id] = defaultAssignment([...keys, action.name]);
        } else if (isDefaultAssignment(a, keys)) {
          assignments[item.id] = Array.isArray(a) ? [...a, action.name] : { ...a, equal: [...a.equal, action.name] };
        }
      });
      return { ...state, payers, assignments };
    }
    case 'REMOVE_PAYER': {
      if (state.payers.length <= 1) return state; // always keep at least one payer
      // `index` is exact; `name` alone removes the last person with that name.
      const index = Number.isInteger(action.index) ? action.index : state.payers.lastIndexOf(action.name);
      if (index < 0 || index >= state.payers.length) return state;
      const key = assignmentKeys(state)[index];
      const nameKeyByIndex = {};
      Object.keys(state.nameKeyByIndex || {}).forEach((i) => {
        const n = Number(i);
        if (n < index) nameKeyByIndex[n] = state.nameKeyByIndex[i];
        else if (n > index) nameKeyByIndex[n - 1] = state.nameKeyByIndex[i];
      });
      let next = settleKeys({
        ...state,
        payers: state.payers.filter((_, i) => i !== index),
        nameKeyByIndex,
        assignments: stripKeyFromAssignments(state.assignments, key),
      });
      if (next.payers.length === 1 && next.claimMode === 'payers') {
        // One person cannot "let everyone pick": back to host-assigns, and
        // that one person takes every item nobody is on.
        next = { ...next, claimMode: 'host' };
        next = { ...next, assignments: fillUnallocatedWithDefault(next) };
      }
      return next;
    }
    case 'RENAME_PAYER': {
      const oldName = state.payers[action.index];
      if (oldName === undefined || oldName === action.name) return state;
      const keys = assignmentKeys(state);
      const payers = state.payers.map((p, i) => (i === action.index ? action.name : p));
      if (new Set(payers).size !== payers.length) {
        // Two people share a name right now (the roster is invalid and
        // cannot be confirmed). Leave `assignments` alone; the renamed
        // person keeps their old key until the roster is unambiguous.
        return { ...state, payers, nameKeyByIndex: { ...(state.nameKeyByIndex || {}), [action.index]: keys[action.index] } };
      }
      const map = {};
      payers.forEach((name, i) => {
        if (keys[i] !== name) map[keys[i]] = name;
      });
      return { ...state, payers, nameKeyByIndex: {}, assignments: rekeyAssignments(state.assignments, map) };
    }
    case 'SET_CLAIM_MODE': {
      if (state.claimMode === action.mode) return state;
      if (action.mode === 'payers') {
        // Everyone-picks starts from a clean slate: nothing is assigned.
        return { ...state, claimMode: 'payers', assignments: {} };
      }
      const next = { ...state, claimMode: action.mode };
      return { ...next, assignments: fillUnallocatedWithDefault(next) };
    }
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
      const before = state.parsed.items.find((item) => item.id === action.itemId);
      if (!before) return state;
      const { field, value } = action;
      let after = { ...before, [field]: value };
      let kind = null; // how the line price was reached by this edit
      if (field === 'qty' || field === 'unit_price') {
        // Only the host's own edit of qty or unit price works out a line price.
        // A quantity that is not above zero (or a price that is not a number)
        // leaves the line price alone. Qty and unit price stay as typed.
        const product = lineTotalFromQty(after.qty, after.unit_price);
        if (product) {
          after = { ...after, line_total: fromCents(product.cents) };
          kind = product.rounded ? 'rounded' : 'calc';
        }
      } else if (field === 'line_total') {
        kind = 'kept';
      }
      const items = state.parsed.items.map((item) => (item.id === action.itemId ? after : item));
      let parsed = { ...state.parsed, items };
      let derived = state.derived;
      if (kind) {
        const prior = state.derived || initialState.derived;
        // The subtotal moves by exactly what the line price moved, in cents;
        // service, tax, discounts, rounding and the grand total never move.
        const delta = toCents(after.line_total) - toCents(before.line_total);
        if (delta !== 0) parsed = { ...parsed, subtotal: fromCents(toCents(state.parsed.subtotal) + delta) };
        derived = {
          lines: { ...prior.lines, [action.itemId]: kind },
          subtotalMoved: prior.subtotalMoved || delta !== 0,
          last: action.itemId, // the row the host just edited, for the brief highlight
        };
      }
      return { ...state, parsed, derived };
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
      const lines = { ...(state.derived || initialState.derived).lines };
      delete lines[action.itemId];
      return {
        ...state,
        parsed: { ...state.parsed, items },
        assignments,
        derived: { ...(state.derived || initialState.derived), lines },
      };
    }
    case 'UPDATE_BILL_FIELD':
      if (!state.parsed) return state;
      return {
        ...state,
        parsed: { ...state.parsed, [action.field]: action.value },
        // A subtotal the host types is theirs, not one that moved with an item edit.
        derived: action.field === 'subtotal' ? { ...state.derived, subtotalMoved: false } : state.derived,
      };
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
