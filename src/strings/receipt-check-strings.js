// src/strings/receipt-check-strings.js
//
// The words for the receipt-check screens (the tick, the difference line, the
// calculated-price cues), in one place and keyed, so a translation library can
// replace this file later without touching the screens. English only.
//
// `{amount}` is a ready-formatted RM figure (for example "RM 0.03"); amounts
// are never part of the sentence itself.

export const STRINGS = {
  'tick.label': 'This matches my paper receipt',
  'tick.detail.higher': 'The receipt total is {amount} higher than its own lines add up to.',
  'tick.detail.lower': 'The receipt total is {amount} lower than its own lines add up to.',
  'tick.consequence': 'Nothing on the receipt is changed. The {amount} is shown to everyone as "Difference on receipt".',
  'tick.cleared': 'Tick cleared because a figure changed. Tick again if the screen still matches your paper.',
  'confirm.reason.needs_tick':
    'Tick that the screen matches your paper receipt, or fix the figure that is different',
  'confirm.reason.hard_error': 'Confirm is off until the problem shown in Bill totals is fixed.',
  'panel.pointer':
    'Check each amount against your paper receipt and fix the one that is different. If the screen already matches the paper, tick the box above Confirm.',
  'panel.ticked.title': 'Matches your paper receipt',
  'panel.ticked.adds': 'Difference on receipt: adds {amount}. Everything else is as shown.',
  'panel.ticked.takes_off': 'Difference on receipt: takes off {amount}. Everything else is as shown.',
  'diff.label': 'Difference on receipt',
  'diff.adds': 'Adds {amount}',
  'diff.takes_off': 'Takes off {amount}',
  'diff.helper.review': 'The receipt total differs from its own lines by this amount. Shared by what each person ordered.',
  'diff.helper.payer': 'The printed total differs from the printed lines by this amount. Shared by what each person ordered.',
  'error.save_not_add_up':
    'We could not save this because the figures do not add up. Check Bill totals, then tick again if the screen matches your paper receipt.',
  'calc.cue': 'Calculated from qty x price',
  'calc.cue.rounded': 'Rounded to the nearest sen',
  'calc.cue.kept': 'Price as you entered it',
  'subtotal.moved': 'Moved with your item edit. For your reference.',
};

/** The text for a key, with `{name}` placeholders filled from `vars`. */
export function t(key, vars = {}) {
  const text = STRINGS[key];
  if (text === undefined) throw new Error(`Unknown string key: ${key}`);
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/** Keys whose wording describes money direction or a value the app settled. */
export const MONEY_SENSITIVE_KEYS = [
  'tick.detail.higher',
  'tick.detail.lower',
  'tick.consequence',
  'panel.ticked.adds',
  'panel.ticked.takes_off',
  'diff.label',
  'diff.adds',
  'diff.takes_off',
  'diff.helper.review',
  'diff.helper.payer',
  'calc.cue.rounded',
];
