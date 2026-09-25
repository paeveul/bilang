// src/screens/review-validation.js — client-side mirror of the item rules in
// api/_lib/validate.js's validateSplitCreateRequest (name non-empty and
// <= 200 chars, qty finite and > 0, unit_price finite and >= 0, line_total
// finite, category one of the five). It exists so ReviewScreen can stop a
// bad item BEFORE the customer reaches the payment step, where the server
// would otherwise reject with a generic error. If validate.js's item rules
// change, change this file too. Plain JS (no JSX), no dependencies.

export const MAX_NAME_LEN = 200;
export const VALID_CATEGORIES = ['food', 'drink', 'tax', 'service', 'other'];

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// Field order = the order focus is sent to (first problem wins).
export function validateItem(item, index) {
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const label = name ? `"${name}"` : `Item ${index + 1}`;
  const problems = [];

  if (!name) {
    problems.push({ field: 'name', message: `${label} has no name. Type what it is.` });
  } else if (item.name.length > MAX_NAME_LEN) {
    problems.push({
      field: 'name',
      message: `${label} has a name that is too long. Keep it to ${MAX_NAME_LEN} characters or fewer.`,
    });
  }
  if (!isFiniteNumber(item.qty) || item.qty <= 0) {
    problems.push({ field: 'qty', message: `${label}: quantity must be more than 0.` });
  }
  if (!isFiniteNumber(item.unit_price) || item.unit_price < 0) {
    problems.push({ field: 'unit_price', message: `${label}: unit price can't be negative.` });
  }
  if (!isFiniteNumber(item.line_total)) {
    problems.push({ field: 'line_total', message: `${label}: line total must be a number.` });
  }
  if (typeof item.category !== 'string' || !VALID_CATEGORIES.includes(item.category)) {
    problems.push({ field: 'category', message: `${label}: pick a category.` });
  }
  return problems;
}

// Returns [{ itemId, problems: [{ field, message }] }] — only items with problems.
export function validateItems(items) {
  const out = [];
  items.forEach((item, index) => {
    const problems = validateItem(item, index);
    if (problems.length > 0) out.push({ itemId: item.id, problems });
  });
  return out;
}
