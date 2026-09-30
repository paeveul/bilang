#!/usr/bin/env node
// scripts/receipt-quality-harness.mjs
//
// Item 17 Step 3 (bilang-mvp1-implementation-plans.md §17.4, §17.6). NOT a
// unit test and NOT shipped to Vercel (Vercel only bundles /api as functions,
// per vercel.json — nothing here is on that path). This is the fixture
// harness that measures whether RECEIPT_TOOL's read_quality/unreadable_reason/
// needs_check signal is actually honest, which only shows up against real
// photographs — see the plan's own framing: "this is the item in MVP1 that
// cannot be verified by reading a diff."
//
// It calls the real Anthropic API (ANTHROPIC_API_KEY from .env) once per
// fixture image and costs real money — this is not something to run in CI
// or on every commit. It exists to be run by hand, deliberately, against
// Alex's ~40-photo fixture set (tracker Dashboard §0.2 row 12).
//
// Usage:
//   node scripts/receipt-quality-harness.mjs --tier=1 [--dir=<path>] [--out=<path>]
//
//   --tier   1 | 2 | 3, see CALL_TIERS in api/_lib/anthropic.js (§17.7 Q2's
//            cost ladder). Defaults to 1 (cheapest — today's config, just the
//            reworded prompt). Run the ladder cheapest-first per the plan:
//            only move to tier 2, then tier 3, if the current tier fails one
//            of the two hard gates below.
//   --dir    Fixture photo folder. Defaults to RECEIPT_FIXTURES_DIR in .env.
//            This folder is NOT part of the repo (see README-receipt-quality-
//            harness.md) — Bilang's privacy posture is that receipt images
//            are never persisted, and that includes never committing fixture
//            photos to git.
//   --out    Output CSV path. Defaults to
//            scripts/harness-output/tier-<n>-<timestamp>.csv (gitignored).
//
// Expected-verdict comparison (§17.6 "Alex adds an expected-verdict column
// by hand once, and thereafter every run is a diff against it"): if
// <fixture-dir>/expected.csv exists with columns `filename,band,expected_verdict`,
// each run's CSV gets a `matches_expected` column, and the two hard gates
// (§17.6's pass bar table) are checked and printed to the console:
//   - 0 false "clear" verdicts on the `not_a_receipt` band
//   - 0 false "unreadable" verdicts on the `clean` band
// Without expected.csv, the harness still runs and writes the CSV — Alex
// fills in the expected_verdict column of the first run's output by hand,
// saves it as expected.csv in the fixture folder, and re-runs from there.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Load .env the same lightweight way the rest of this repo expects it to be
// present (no dotenv dependency here — this mirrors what Vercel dev / the
// app's own local setup already assumes: ANTHROPIC_API_KEY etc. are in the
// environment). If .env exists and the vars aren't already set, parse it.
async function loadDotEnvIfNeeded() {
  const envPath = path.join(repoRoot, '.env');
  if (!existsSync(envPath)) return;
  const raw = await readFile(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = { tier: '1' };
  for (const raw of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(raw);
    if (!m) continue;
    args[m[1]] = m[2];
  }
  return args;
}

const MEDIA_TYPE_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  // Claude vision has no distinct HEIC media type — same fallback api/parse.js
  // uses in production (treat as jpeg's media type). A genuine HEIC file's
  // bytes may not actually decode under that label; this mirrors the
  // production caveat rather than fixing it, since fixing it is out of this
  // item's scope.
  '.heic': 'image/jpeg',
};

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsvRow(fields) {
  return fields.map(csvEscape).join(',') + '\n';
}

async function loadExpected(fixtureDir) {
  const expectedPath = path.join(fixtureDir, 'expected.csv');
  if (!existsSync(expectedPath)) return null;
  const raw = await readFile(expectedPath, 'utf8');
  const lines = raw.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.trim());
  const filenameIdx = header.indexOf('filename');
  const bandIdx = header.indexOf('band');
  const verdictIdx = header.indexOf('expected_verdict');
  if (filenameIdx === -1 || verdictIdx === -1) {
    console.warn('expected.csv found but missing filename/expected_verdict columns — ignoring it.');
    return null;
  }
  const byFilename = new Map();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    byFilename.set(cols[filenameIdx].trim(), {
      band: bandIdx === -1 ? '' : (cols[bandIdx] || '').trim(),
      expected_verdict: (cols[verdictIdx] || '').trim(),
    });
  }
  return byFilename;
}

async function main() {
  await loadDotEnvIfNeeded();
  // Deferred until after .env load — anthropic.js reads ANTHROPIC_API_KEY at
  // call time (getClient()), not at import time, but PARSE_RECEIPT_TIER and
  // RECEIPT_FIXTURES_DIR are read here, so load order matters.
  const { parseReceipt } = await import('../api/_lib/anthropic.js');

  const args = parseArgs(process.argv.slice(2));
  const tier = args.tier;
  const fixtureDir = args.dir || process.env.RECEIPT_FIXTURES_DIR;

  if (!fixtureDir) {
    console.error(
      'No fixture folder given. Pass --dir=<path> or set RECEIPT_FIXTURES_DIR in .env.\n' +
      'See scripts/README-receipt-quality-harness.md.'
    );
    process.exitCode = 1;
    return;
  }
  if (!existsSync(fixtureDir)) {
    console.error(`Fixture folder does not exist: ${fixtureDir}`);
    process.exitCode = 1;
    return;
  }

  const entries = await readdir(fixtureDir, { withFileTypes: true });
  const images = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => MEDIA_TYPE_BY_EXT[path.extname(name).toLowerCase()])
    .sort();

  if (images.length === 0) {
    console.error(`No image files (.jpg/.jpeg/.png/.webp/.heic) found in ${fixtureDir}`);
    process.exitCode = 1;
    return;
  }

  const expected = await loadExpected(fixtureDir);

  const outDir = path.join(repoRoot, 'scripts', 'harness-output');
  await mkdir(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = args.out || path.join(outDir, `tier-${tier}-${timestamp}.csv`);

  const header = [
    'filename',
    'read_quality',
    'unreadable_reason',
    'item_count',
    'sum_line_totals',
    'needs_check_count',
    'stop_reason',
    'model',
    'elapsed_ms',
    'error',
    'expected_verdict',
    'matches_expected',
  ];
  let csv = toCsvRow(header);

  const results = [];

  console.log(`Running tier ${tier} against ${images.length} fixture(s) in ${fixtureDir}...`);

  for (const filename of images) {
    const filePath = path.join(fixtureDir, filename);
    const mediaType = MEDIA_TYPE_BY_EXT[path.extname(filename).toLowerCase()];
    const buffer = await readFile(filePath);
    const base64 = buffer.toString('base64');

    const startedAt = Date.now();
    let row;
    try {
      const { parsed, model, stopReason } = await parseReceipt(base64, mediaType, tier);
      const elapsedMs = Date.now() - startedAt;
      const needsCheckCount = Array.isArray(parsed.items)
        ? parsed.items.filter((i) => i && i.needs_check === true).length
        : 0;
      const sumLineTotals = Array.isArray(parsed.items)
        ? parsed.items.reduce((sum, i) => sum + (typeof i.line_total === 'number' ? i.line_total : 0), 0)
        : 0;

      const expectedEntry = expected ? expected.get(filename) : null;
      const expectedVerdict = expectedEntry ? expectedEntry.expected_verdict : '';
      const matchesExpected = expectedVerdict ? String(parsed.read_quality === expectedVerdict) : '';

      row = {
        filename,
        read_quality: parsed.read_quality,
        unreadable_reason: parsed.unreadable_reason,
        item_count: Array.isArray(parsed.items) ? parsed.items.length : 0,
        sum_line_totals: sumLineTotals.toFixed(2),
        needs_check_count: needsCheckCount,
        stop_reason: stopReason,
        model,
        elapsed_ms: elapsedMs,
        error: '',
        expected_verdict: expectedVerdict,
        matches_expected: matchesExpected,
        band: expectedEntry ? expectedEntry.band : '',
      };
      console.log(`  ${filename}: read_quality=${parsed.read_quality} unreadable_reason=${parsed.unreadable_reason} items=${row.item_count} (${elapsedMs}ms)`);
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      row = {
        filename,
        read_quality: '',
        unreadable_reason: '',
        item_count: '',
        sum_line_totals: '',
        needs_check_count: '',
        stop_reason: err.code === 'max_tokens_truncated' ? 'max_tokens' : '',
        model: '',
        elapsed_ms: elapsedMs,
        error: err.message,
        expected_verdict: expected && expected.get(filename) ? expected.get(filename).expected_verdict : '',
        matches_expected: '',
        band: expected && expected.get(filename) ? expected.get(filename).band : '',
      };
      console.error(`  ${filename}: ERROR — ${err.message}`);
    }
    results.push(row);
    csv += toCsvRow([
      row.filename,
      row.read_quality,
      row.unreadable_reason,
      row.item_count,
      row.sum_line_totals,
      row.needs_check_count,
      row.stop_reason,
      row.model,
      row.elapsed_ms,
      row.error,
      row.expected_verdict,
      row.matches_expected,
    ]);
  }

  await writeFile(outPath, csv, 'utf8');
  console.log(`\nWrote ${results.length} row(s) to ${outPath}`);

  if (expected) {
    printHardGates(results);
  } else {
    console.log(
      '\nNo expected.csv found in the fixture folder — hard-gate check skipped. ' +
      'See scripts/README-receipt-quality-harness.md for the expected-verdict workflow.'
    );
  }
}

// The two hard gates from §17.6's pass bar table. `band` values are whatever
// Alex's expected.csv uses; only the two band names below are load-bearing
// for a hard-gate fail. Every other band is reported, never gated (per plan).
function printHardGates(results) {
  const notAReceipt = results.filter((r) => r.band === 'not_a_receipt');
  const clean = results.filter((r) => r.band === 'clean');

  const falseClear = notAReceipt.filter((r) => r.read_quality === 'clear');
  const falseUnreadable = clean.filter((r) => r.read_quality === 'unreadable');

  console.log('\n--- §17.6 hard gates ---');
  if (notAReceipt.length > 0) {
    const status = falseClear.length === 0 ? 'PASS' : 'FAIL';
    console.log(`[${status}] False "clear" on not_a_receipt band: ${falseClear.length} of ${notAReceipt.length} (bar: 0)`);
    if (falseClear.length > 0) console.log(`        ${falseClear.map((r) => r.filename).join(', ')}`);
  } else {
    console.log('[SKIP] No rows tagged band=not_a_receipt in expected.csv');
  }
  if (clean.length > 0) {
    const status = falseUnreadable.length === 0 ? 'PASS' : 'FAIL';
    console.log(`[${status}] False "unreadable" on clean band: ${falseUnreadable.length} of ${clean.length} (bar: 0)`);
    if (falseUnreadable.length > 0) console.log(`        ${falseUnreadable.map((r) => r.filename).join(', ')}`);
  } else {
    console.log('[SKIP] No rows tagged band=clean in expected.csv');
  }
  console.log('Everything else (partial/faded split, reason values, needs_check distribution) is reported in the CSV, not gated — see §17.6.');
}

main().catch((err) => {
  console.error('Harness failed:', err);
  process.exitCode = 1;
});
