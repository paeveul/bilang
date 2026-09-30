# Receipt-quality fixture harness (Item 17 Step 3)

Reference: `bilang/technical/bilang-mvp1-implementation-plans.md` §17.6 (verification),
§17.4 Step 3, §17.7 Q2 (the tiered cost ladder this harness is built to test).

This harness answers one question a code review cannot: **is Claude actually
honest about whether it could read a receipt?** It is not a unit test — it
calls the real Anthropic API against real photographs and costs real money.
Run it by hand, deliberately.

## Who does what

- **Howard built the harness and this README** (Item 17 Step 3).
- **Alex takes the ~40 fixture photographs and reviews the CSV** (tracker
  Dashboard §0.2, row 12 — "Run the ~40-photo harness test," gated on this
  Step 3 build, explicitly *not* something Howard runs). This is not
  delegable — it needs a person who can look at a photo and say whether a
  human could read it.

## 1. Set up the fixture folder

Fixture photos are **never committed to this repo** — Bilang's entire privacy
posture is that receipt images are never persisted, and forty of them sitting
in git history would contradict that in the most visible place possible.

1. Pick a folder outside the repo (e.g. `~/bilang-fixtures/`).
2. Add `RECEIPT_FIXTURES_DIR=/absolute/path/to/that/folder` to `.env`
   (already gitignored — this is exactly the kind of local-only value it's
   for).
3. Drop photos into it. Suggested composition (§17.6's table — each band
   tests a different failure mode):

   | Band | Count | Tests |
   |---|---|---|
   | Clean printed receipts | 15 | Over-flagging (false "unreadable") |
   | Faded thermal paper | 8 | Where "partial" earns its keep |
   | Handwritten chits / warung tabs | 5 | Should read "unreadable", reason "handwritten" |
   | Angled, glare, partial crop, finger in frame | 5 | Retake-fixable — reason value matters here |
   | Not a receipt (menu, wall, blank, hand) | 4 | Catastrophic failure mode (false "clear") |
   | Known-hard: multi-page, two receipts in frame, non-Latin script | 3 | Reported, not gated — tells us the ceiling |

## 2. Run a tier

```
node scripts/receipt-quality-harness.mjs --tier=1
```

- `--tier=1` — thinking disabled, `effort: low`, 4096 tokens. Today's cost
  profile, just the reworded prompt. **Start here — always run cheapest tier
  first.**
- `--tier=2` — thinking on (`adaptive`), `effort: low`, 8192 tokens.
- `--tier=3` — thinking on (`adaptive`), `effort: medium`, 8192 tokens. The
  most expensive tier; only run this if tier 2 fails a hard gate.

Optional flags: `--dir=<path>` overrides `RECEIPT_FIXTURES_DIR`, `--out=<path>`
overrides the default output location
(`scripts/harness-output/tier-<n>-<timestamp>.csv`, gitignored).

**Only move to the next tier if the current one fails a hard gate below.**
Per §17.6: "the lever order is: (1) field descriptions and prompt wording,
(2) `effort` up one level, (3) reconsider the enum boundary." Change one
thing at a time and re-run.

## 3. The expected-verdict workflow

First run: no `expected.csv` exists yet, so the harness just writes the CSV
with an empty `expected_verdict` column and skips the hard-gate check.

1. Open the output CSV. For each row, fill in what a human would actually
   say — was this receipt clear, partial, or genuinely unreadable?
2. Save a copy as `expected.csv` **inside the fixture folder** (not
   `scripts/harness-output/`) with at least these columns:
   `filename,band,expected_verdict` — `band` matching the table above
   (`clean`, `faded`, `handwritten`, `angled_glare_crop`, `not_a_receipt`,
   `known_hard`), `expected_verdict` one of `clear`/`partial`/`unreadable`.
3. Every run after that automatically joins against `expected.csv`, adds a
   `matches_expected` column, and prints the two hard gates to the console.

## 4. The pass bar — two hard gates, everything else reported

| Gate | Bar |
|---|---|
| False "clear" on the `not_a_receipt` band | **0 of 4** |
| False "unreadable" on the `clean` band | **0 of 15** |

Everything else — the clear/partial split on faded thermal, the reason
values, the `needs_check` distribution — is **reported in the CSV, not
gated**. There's no ground truth for "should this specific receipt have been
partial," so nothing invents one.

**Do not proceed to Item 17 Step 4 (wiring the classifier) before both gates
pass.** A classifier wired to an uncalibrated signal is worse than none — it
converts a silent problem into a visible one that fires on the wrong inputs.

## 5. Re-run triggers (S18)

Re-run the full ladder against the fixture set whenever any of the following
changes:

- The model id (`ANTHROPIC_MODEL` / `MODEL_ID` in `api/_lib/anthropic.js`)
- `thinking` or `effort` for the tier in use
- `max_tokens`
- The `RECEIPT_TOOL` tool description
- Any field description inside `RECEIPT_TOOL.input_schema` — they are read by
  the model on every call and are part of the shipped artefact, not just
  documentation

## What this harness does not decide

It measures. It does not pick a tier, wire a classifier, or change what ships
to production — that's Alex reading the CSV, and (for Steps 4-5, once Item 13
exists) Howard wiring `api/parse.js`'s classifier per §17.3's expression. If a
higher tier turns out to be necessary, promoting the default tier is a
one-line change: `DEFAULT_TIER` in `api/_lib/anthropic.js`.
