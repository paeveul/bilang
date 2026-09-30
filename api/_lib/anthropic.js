// api/_lib/anthropic.js
//
// Thin wrapper around the Anthropic SDK for the receipt-parsing call. Owns:
// the model choice, the strict tool-use schema (roadmap D2 — never let the
// model free-generate numerals), and the single messages.create() call.
// Nothing else in the app should import @anthropic-ai/sdk directly.
//
// Model: claude-sonnet-5, per the roadmap's explicit product decision (D1) —
// accuracy on messy/faded/handwritten Malaysian receipts matters more than
// the small cost gap vs Haiku 4.5. Do not swap this for Haiku without
// re-reading D1's reasoning; Haiku↔Sonnet auto-routing is explicit MVP-3
// scope (D5), not built here.
//
// Item 17 (unreadable-receipt signal) — plan doc
// bilang-mvp1-implementation-plans.md §17, Steps 1-2 of 17.4. `read_quality`,
// `unreadable_reason` and per-item `needs_check` (17.3) let the model report
// "I could not read this" instead of returning a plausible-looking invention.
// `strict: true` and forced `tool_choice` are unchanged (S4/S5) — the fix
// widens the schema's vocabulary, it does not loosen its guarantees.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL_ID = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const RECEIPT_TOOL = {
  name: 'record_receipt',
  description:
    'Record the itemized contents of a restaurant/mamak receipt. Report honestly ' +
    'what you could actually read — reporting `read_quality: "unreadable"` with an ' +
    'empty `items` array is a correct and complete answer for an image that cannot ' +
    'be read as a receipt, not a failure. Do not guess, round, or invent any number ' +
    'or value you cannot actually read clearly; mark it as unclear instead of filling ' +
    'it in.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Every line item on the receipt, in the order printed. Empty if the receipt could not be read at all (read_quality: "unreadable").',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Item name/label exactly as printed.' },
            category: {
              type: 'string',
              enum: ['food', 'drink', 'tax', 'service', 'other'],
              description: 'Best-guess category for this line item.',
            },
            qty: { type: 'number', description: 'Quantity ordered.' },
            unit_price: { type: 'number', description: 'Price per unit, in RM.' },
            line_total: { type: 'number', description: 'Total price for this line, in RM.' },
            needs_check: {
              type: 'boolean',
              description:
                'true when any part of this specific line — its name, its quantity, or its ' +
                'price — was not read cleanly and a person should confirm it. false when the ' +
                'whole line was read directly off the image.',
            },
          },
          required: ['name', 'category', 'qty', 'unit_price', 'line_total', 'needs_check'],
          additionalProperties: false,
        },
      },
      subtotal: {
        type: 'number',
        description: 'Receipt subtotal before tax/service charge, in RM.',
      },
      service_charge: {
        type: 'number',
        description: 'Service charge amount in RM. Use 0 if the receipt has none.',
      },
      tax: {
        type: 'number',
        description: 'Tax amount (e.g. SST) in RM. Use 0 if the receipt has none.',
      },
      grand_total: {
        type: 'number',
        description: 'Final total printed on the receipt, in RM.',
      },
      // Item 23 (merchant name + receipt date) — D1: both optional, left out
      // of `required` below. A receipt can be cropped or faded exactly where
      // the name or date sits, and a guessed value is worse than none, same
      // "never invent a number/value you cannot read" doctrine the rest of
      // this schema already follows.
      merchant_name: {
        type: 'string',
        description: 'Restaurant/merchant name exactly as printed, if legible.',
      },
      receipt_date: {
        type: 'string',
        description: 'Receipt date in ISO YYYY-MM-DD format, if legible. Convert from whatever format is printed.',
      },
      // Item 17 (S1/S2, 17.3) — both required, both enums. `read_quality` is
      // the receipt-level verdict; `unreadable_reason` always carries a value
      // ('none' when read_quality is 'clear') rather than being optional, so
      // the model cannot quietly omit bad news the way it could omit an
      // optional field.
      read_quality: {
        type: 'string',
        enum: ['clear', 'partial', 'unreadable'],
        description:
          '"clear" — every line and total was read directly off the image. ' +
          '"partial" — the receipt was read, but at least one line or total was obscured, ' +
          'cut off, or ambiguous and had to be left out or guessed at. ' +
          '"unreadable" — this image could not be read as a receipt at all; any values ' +
          'below would be invention.',
      },
      unreadable_reason: {
        type: 'string',
        enum: ['none', 'not_a_receipt', 'too_blurry', 'too_faded', 'obscured_or_cropped', 'handwritten', 'other'],
        description: "Why the receipt could not be read fully. \"none\" when read_quality is \"clear\".",
      },
    },
    required: ['items', 'subtotal', 'service_charge', 'tax', 'grand_total', 'read_quality', 'unreadable_reason'],
    additionalProperties: false,
  },
};

// Item 17, §17.7 Q2 — the cost/latency ladder. S9/S10 ("adaptive thinking,
// effort: medium") were revised from a settled default to the top of a
// three-tier ladder that 17.6's fixture harness resolves empirically,
// cheapest tier first, per Alex's explicit cost concern (2026-08-17,
// "shouldn't be more than what users are already paying for... it should be
// plain and simple OCR"). Tier 1 — thinking disabled, today's `effort: low`,
// only the prompt wording changes — is the production default until a
// harness run against Alex's real fixture photos (tracker Dashboard §0.2
// row 12, still pending) proves a higher tier is actually needed to clear
// 17.6's two hard gates. Promoting the default is a one-line change here,
// not a schema or data-model change.
const CALL_TIERS = {
  1: { thinking: { type: 'disabled' }, output_config: { effort: 'low' }, max_tokens: 4096 },
  2: { thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, max_tokens: 8192 },
  3: { thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, max_tokens: 8192 },
};

const DEFAULT_TIER = '1';

/**
 * Resolve a tier argument (1|2|3, as a number or string) to its call
 * configuration. Falls back to `PARSE_RECEIPT_TIER` env var, then
 * DEFAULT_TIER, so production and the harness (17.6) share one source of
 * truth for what each tier number means.
 *
 * @param {number|string} [tier]
 * @returns {{thinking: object, output_config: object, max_tokens: number}}
 */
function getCallConfig(tier) {
  const key = String(tier ?? process.env.PARSE_RECEIPT_TIER ?? DEFAULT_TIER);
  const config = CALL_TIERS[key];
  if (!config) {
    throw new Error(`Unknown receipt-parse tier "${key}" — expected one of ${Object.keys(CALL_TIERS).join(', ')}`);
  }
  return config;
}

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Parse a single receipt image into structured items via Claude vision +
 * strict tool-use. The image buffer is never persisted anywhere by this
 * function or anything it calls — it lives only in this request's memory.
 *
 * Item 17 return-shape note (17.3): the resolved value carries `model` and
 * `stopReason` alongside `parsed` for the harness (17.6) and the server log
 * only — callers that just want the receipt (api/parse.js) read `.parsed`
 * and never forward `.model`/`.stopReason` into a client-facing response.
 *
 * @param {string} base64Image - raw base64 image data (no data: URI prefix)
 * @param {string} mediaType - 'image/jpeg' | 'image/png' | 'image/webp'
 * @param {number|string} [tier] - 1|2|3, see CALL_TIERS. Defaults to
 *   PARSE_RECEIPT_TIER env var, then DEFAULT_TIER.
 * @returns {Promise<{parsed: object, model: string, stopReason: string}>}
 */
async function parseReceipt(base64Image, mediaType, tier) {
  const anthropic = getClient();
  const { thinking, output_config, max_tokens } = getCallConfig(tier);

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens,
    thinking,
    output_config,
    tools: [RECEIPT_TOOL],
    tool_choice: { type: 'tool', name: 'record_receipt' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image },
          },
          {
            type: 'text',
            text:
              'This is a photo of a Malaysian restaurant/mamak receipt. Extract every line ' +
              'item with its category, quantity, unit price, and line total, plus the ' +
              'subtotal, service charge, tax, and grand total. Also extract the merchant ' +
              'name and the receipt date (convert to ISO YYYY-MM-DD) if legible, leaving ' +
              'them out otherwise. The receipt may be faded thermal paper, handwritten, or ' +
              'photographed at an angle — do your best, but never invent a number or value ' +
              'you cannot actually read. ' +
              'For every number and every line, ask yourself whether you actually read it ' +
              'off the image or had to infer/guess it — not how confident you feel about it. ' +
              'Mark anything inferred or guessed with needs_check: true on that line, and set ' +
              'read_quality honestly: "clear" only if every line and total was read directly; ' +
              '"partial" if some lines were, but at least one was not; "unreadable" if you ' +
              'cannot make out the receipt at all. A "partial" or "unreadable" verdict costs ' +
              'the customer nothing and is strongly preferred over a complete-looking guess — ' +
              'it is never treated as a worse answer than a confident one.',
          },
        ],
      },
    ],
  });

  // Item 17, S9-S11 consequence: with thinking on, max_tokens bounds thinking
  // and response text together, so a long receipt can truncate the tool call
  // before it completes. Guarded before we go looking for tool_use so a
  // truncation is diagnosable in the logs as its own thing, rather than
  // falling through to the generic "no tool_use block" throw below and
  // looking identical to an ordinary outage.
  if (response.stop_reason === 'max_tokens') {
    const err = new Error('Model response was truncated at max_tokens before completing the tool call');
    err.code = 'max_tokens_truncated';
    throw err;
  }

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Model did not return a structured receipt (no tool_use block)');
  }
  return { parsed: toolUse.input, model: response.model, stopReason: response.stop_reason };
}

module.exports = { parseReceipt, MODEL_ID, RECEIPT_TOOL, CALL_TIERS, DEFAULT_TIER, getCallConfig };
