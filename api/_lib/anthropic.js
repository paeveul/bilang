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

const Anthropic = require('@anthropic-ai/sdk');

const MODEL_ID = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const RECEIPT_TOOL = {
  name: 'record_receipt',
  description:
    'Record the itemized contents of a restaurant/mamak receipt exactly as printed. ' +
    'Do not guess, round, or invent any number you cannot actually read clearly — ' +
    'extract only what is legible on the receipt.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Every line item on the receipt, in the order printed.',
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
          },
          required: ['name', 'category', 'qty', 'unit_price', 'line_total'],
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
    },
    required: ['items', 'subtotal', 'service_charge', 'tax', 'grand_total'],
    additionalProperties: false,
  },
};

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
 * @param {string} base64Image - raw base64 image data (no data: URI prefix)
 * @param {string} mediaType - 'image/jpeg' | 'image/png' | 'image/webp'
 * @returns {Promise<object>} parsed receipt matching RECEIPT_TOOL.input_schema
 */
async function parseReceipt(base64Image, mediaType) {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 4096,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
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
              'subtotal, service charge, tax, and grand total. The receipt may be faded ' +
              'thermal paper, handwritten, or photographed at an angle — do your best, but ' +
              'never invent a number you cannot actually read.',
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Model did not return a structured receipt (no tool_use block)');
  }
  return toolUse.input;
}

module.exports = { parseReceipt, MODEL_ID };
