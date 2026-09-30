// api/_lib/anthropic.test.mjs — Item 17 Steps 1-2 (bilang-mvp1-implementation-plans.md
// §17.4): RECEIPT_TOOL's schema additions (read_quality, unreadable_reason,
// per-item needs_check), the three-tier call-configuration ladder (§17.7 Q2),
// and the stop_reason max_tokens guard (§17.3). Mocks @anthropic-ai/sdk the
// same way api/_lib/supabase.test.mjs mocks @supabase/supabase-js — no live
// API call is made here. The real signal-quality question (is the model
// actually honest) is what the 17.6 fixture harness answers against real
// photographs, not this file.
//
// Run: node --test api/_lib/anthropic.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let nextResponse = null;
const calls = [];

const sdkPath = require.resolve('@anthropic-ai/sdk');
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: class Anthropic {
    constructor(opts) {
      this._opts = opts;
    }
    get messages() {
      return {
        create: async (request) => {
          calls.push(request);
          return nextResponse;
        },
      };
    }
  },
};

process.env.ANTHROPIC_API_KEY = 'stub-key';

const {
  parseReceipt,
  RECEIPT_TOOL,
  CALL_TIERS,
  DEFAULT_TIER,
  getCallConfig,
} = require('./anthropic.js');

function validToolResponse(overrides = {}) {
  return {
    model: 'claude-sonnet-5-20260915',
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        name: 'record_receipt',
        input: {
          items: [
            {
              name: 'Nasi Lemak',
              category: 'food',
              qty: 1,
              unit_price: 12.5,
              line_total: 12.5,
              needs_check: false,
            },
          ],
          subtotal: 12.5,
          service_charge: 0,
          tax: 0,
          grand_total: 12.5,
          read_quality: 'clear',
          unreadable_reason: 'none',
          ...overrides,
        },
      },
    ],
  };
}

beforeEach(() => {
  calls.length = 0;
  nextResponse = validToolResponse();
  delete process.env.PARSE_RECEIPT_TIER;
});

// --- Schema shape (Step 1) --------------------------------------------

test('RECEIPT_TOOL keeps strict: true and additionalProperties: false at both levels (S4)', () => {
  assert.equal(RECEIPT_TOOL.strict, true);
  assert.equal(RECEIPT_TOOL.input_schema.additionalProperties, false);
  assert.equal(RECEIPT_TOOL.input_schema.properties.items.items.additionalProperties, false);
});

test('read_quality is a required top-level enum with the three §17.1 S1 values', () => {
  const field = RECEIPT_TOOL.input_schema.properties.read_quality;
  assert.deepEqual(field.enum, ['clear', 'partial', 'unreadable']);
  assert.ok(RECEIPT_TOOL.input_schema.required.includes('read_quality'));
});

test('unreadable_reason is a required top-level enum carrying an explicit "none" member (S2)', () => {
  const field = RECEIPT_TOOL.input_schema.properties.unreadable_reason;
  assert.ok(field.enum.includes('none'));
  assert.deepEqual(
    field.enum,
    ['none', 'not_a_receipt', 'too_blurry', 'too_faded', 'obscured_or_cropped', 'handwritten', 'other']
  );
  assert.ok(RECEIPT_TOOL.input_schema.required.includes('unreadable_reason'));
});

test('needs_check is a required boolean on every item, not the receipt (S3)', () => {
  const itemSchema = RECEIPT_TOOL.input_schema.properties.items.items;
  assert.equal(itemSchema.properties.needs_check.type, 'boolean');
  assert.ok(itemSchema.required.includes('needs_check'));
  assert.ok(!('needs_check' in RECEIPT_TOOL.input_schema.properties));
});

test('all pre-existing required fields are still required (S6) — the fix widens, it does not loosen', () => {
  assert.deepEqual(
    RECEIPT_TOOL.input_schema.required,
    ['items', 'subtotal', 'service_charge', 'tax', 'grand_total', 'read_quality', 'unreadable_reason']
  );
});

test('the tool description no longer contains the old "extract only what is legible" / mandatory-total contradiction', () => {
  assert.ok(!/extract only what is legible/i.test(RECEIPT_TOOL.description));
  assert.match(RECEIPT_TOOL.description, /unreadable/i);
});

test('merchant_name/receipt_date (Item 23) remain optional — untouched by this item', () => {
  assert.ok(!RECEIPT_TOOL.input_schema.required.includes('merchant_name'));
  assert.ok(!RECEIPT_TOOL.input_schema.required.includes('receipt_date'));
});

// --- Call-configuration ladder (Step 2, §17.7 Q2) ----------------------

test('tier 1 (default) matches production cost today: thinking disabled, effort low, 4096 tokens', () => {
  assert.equal(DEFAULT_TIER, '1');
  const config = getCallConfig();
  assert.deepEqual(config, CALL_TIERS[1]);
  assert.deepEqual(config.thinking, { type: 'disabled' });
  assert.deepEqual(config.output_config, { effort: 'low' });
  assert.equal(config.max_tokens, 4096);
});

test('tier 2 turns thinking on at effort low with the 8192 max_tokens S9-S11 consequence', () => {
  const config = getCallConfig(2);
  assert.deepEqual(config.thinking, { type: 'adaptive' });
  assert.deepEqual(config.output_config, { effort: 'low' });
  assert.equal(config.max_tokens, 8192);
});

test('tier 3 is the original S9/S10 recommendation: adaptive thinking, effort medium, 8192 tokens', () => {
  const config = getCallConfig(3);
  assert.deepEqual(config.thinking, { type: 'adaptive' });
  assert.deepEqual(config.output_config, { effort: 'medium' });
  assert.equal(config.max_tokens, 8192);
});

test('getCallConfig reads PARSE_RECEIPT_TIER when no explicit tier argument is given', () => {
  process.env.PARSE_RECEIPT_TIER = '3';
  assert.deepEqual(getCallConfig(), CALL_TIERS[3]);
});

test('an explicit tier argument wins over PARSE_RECEIPT_TIER', () => {
  process.env.PARSE_RECEIPT_TIER = '3';
  assert.deepEqual(getCallConfig(1), CALL_TIERS[1]);
});

test('an unknown tier throws rather than silently falling back', () => {
  assert.throws(() => getCallConfig(4), /Unknown receipt-parse tier/);
});

// --- parseReceipt() call wiring + stop_reason guard (Step 2, §17.3) ----

test('parseReceipt sends the tier config it resolves and keeps tool_choice forced (S5)', async () => {
  await parseReceipt('base64data', 'image/jpeg', 2);
  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.deepEqual(request.thinking, { type: 'adaptive' });
  assert.deepEqual(request.output_config, { effort: 'low' });
  assert.equal(request.max_tokens, 8192);
  assert.deepEqual(request.tool_choice, { type: 'tool', name: 'record_receipt' });
  assert.deepEqual(request.tools, [RECEIPT_TOOL]);
});

test('parseReceipt returns {parsed, model, stopReason} — model/stopReason are for the harness/log only', async () => {
  const result = await parseReceipt('base64data', 'image/jpeg');
  assert.equal(result.model, 'claude-sonnet-5-20260915');
  assert.equal(result.stopReason, 'tool_use');
  assert.equal(result.parsed.read_quality, 'clear');
  assert.equal(result.parsed.unreadable_reason, 'none');
  assert.equal(result.parsed.items[0].needs_check, false);
});

test('an "unreadable" verdict with an empty items array round-trips as the documented expected shape (17.3)', async () => {
  nextResponse = validToolResponse({ items: [], read_quality: 'unreadable', unreadable_reason: 'too_blurry' });
  const result = await parseReceipt('base64data', 'image/jpeg');
  assert.deepEqual(result.parsed.items, []);
  assert.equal(result.parsed.read_quality, 'unreadable');
  assert.equal(result.parsed.unreadable_reason, 'too_blurry');
});

test('a max_tokens stop_reason throws a distinct, diagnosable error before the tool_use search', async () => {
  nextResponse = { model: 'claude-sonnet-5-20260915', stop_reason: 'max_tokens', content: [] };
  await assert.rejects(
    () => parseReceipt('base64data', 'image/jpeg'),
    (err) => {
      assert.equal(err.code, 'max_tokens_truncated');
      return true;
    }
  );
});

test('no tool_use block still throws the original generic error when stop_reason is not max_tokens', async () => {
  nextResponse = { model: 'claude-sonnet-5-20260915', stop_reason: 'end_turn', content: [] };
  await assert.rejects(
    () => parseReceipt('base64data', 'image/jpeg'),
    /no tool_use block/
  );
});
