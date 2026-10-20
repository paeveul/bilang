#!/usr/bin/env node
// Promote gate (read-only). Decides whether the current tree is fit to become a
// pre-prod / main snapshot. It never edits the working tree.
//
// What it does:
//   1. Copies the tree to a temp dir with whole-line `@dev` comments removed.
//   2. Scans every remaining comment for internal references (plan/tracker
//      refs, Item/Step tags, attributions, personal names, internal dates).
//   3. Scans a proposed commit message (--message) with the same patterns.
//   4. Unless --dry-run: runs `npm test` and `npm run build` in the temp copy,
//      then checks the built output for `@dev` and for internal references in
//      HTML comments.
// Exit code 0 = PASS, 1 = FAIL.
//
//   node scripts/promote-gate.mjs [--dry-run] [--committed] [--message "<text>|@file"]
//                                 [--verbose] [--keep-temp]
//
// --committed  the tree being checked is what gets committed/pushed: it must
//              hold NO @dev lines at all (they are local-only; move them out with
//              scripts/archive-dev-notes.mjs first). Used by the hooks and the
//              GitHub Action on every branch.
// --dry-run   scan only: no npm test, no build.
// --verbose   also list every removed @dev line.
// --keep-temp keep the temp copy (path is printed).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripTreeTo, isScannable, extOf, extractComments, matchPatterns } from './lib/dev-comments.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const dryRun = flag('--dry-run');
const verbose = flag('--verbose');

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bilang-gate-'));
const out = path.join(tmp, 'tree');

// 1. strip into temp ------------------------------------------------------
const stripped = stripTreeTo(root, out);
const removedTotal = stripped.removedByFile.reduce((n, f) => n + f.removed.length, 0);
console.log(`Temp copy: ${out}`);
console.log(`@dev lines that promotion would remove: ${removedTotal} in ${stripped.removedByFile.length} file(s)`);
if (verbose) for (const f of stripped.removedByFile) for (const r of f.removed) console.log(`  - ${f.file}:${r.line}  ${r.content.trim()}`);
if (flag('--committed')) {
  record('committed tree: no @dev notes in the files (they are local-only)', removedTotal === 0,
    `${removedTotal} @dev line(s) in ${stripped.removedByFile.length} file(s). Run: node scripts/archive-dev-notes.mjs`);
}
record('strip: no empty comment blocks left behind', stripped.warnings.length === 0, stripped.warnings.join('; '));

// 2. scan stripped tree ---------------------------------------------------
const violations = [];
let scanned = 0;
for (const f of stripped.files) {
  if (!isScannable(f)) continue;
  const p = path.join(out, f);
  if (!fs.existsSync(p)) continue;
  scanned++;
  for (const c of extractComments(fs.readFileSync(p, 'utf8'), extOf(f))) {
    const hits = matchPatterns(c.text);
    // A marker that survived the strip was not on its own line, so it cannot be removed safely.
    if (/@dev\b/.test(c.text)) hits.push('@dev marker not on its own line');
    if (hits.length) violations.push({ file: f, line: c.line, hits, text: c.text.trim().slice(0, 140) });
  }
}
record(`comment scan (${scanned} files): no internal references left after @dev strip`, violations.length === 0,
  `${violations.length} comment line(s) in ${new Set(violations.map((v) => v.file)).size} file(s)`);

// 3. commit message --------------------------------------------------------
let msg = val('--message');
if (msg && msg.startsWith('@')) msg = fs.readFileSync(msg.slice(1), 'utf8');
const msgViol = [];
if (msg) {
  msg.split(/\r?\n/).forEach((l, i) => {
    const h = matchPatterns(l);
    if (h.length) msgViol.push({ line: i + 1, hits: h, text: l.slice(0, 140) });
  });
  if (/co-authored-by|generated with|claude/i.test(msg)) msgViol.push({ line: 0, hits: ['AI attribution footer'], text: '(attribution text present)' });
  record('commit message: clean', msgViol.length === 0, `${msgViol.length} problem line(s)`);
} else {
  console.log('NOTE: no --message supplied, commit message not checked.');
}

// 4. tests + build in temp copy -------------------------------------------
if (dryRun) {
  console.log('NOTE: --dry-run, npm test and npm run build skipped.');
} else {
  const nm = path.join(out, 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(root, 'node_modules'), nm, 'junction');
  const sh = (cmd) => spawnSync(cmd, { cwd: out, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const t = sh('npm test');
  const tOut = (t.stdout || '') + (t.stderr || '');
  const pass = [...tOut.matchAll(/ℹ pass (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  const fail = [...tOut.matchAll(/ℹ fail (\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  record('npm test on stripped copy', t.status === 0 && fail === 0, `pass ${pass}, fail ${fail}`);
  const b = sh('npm run build');
  record('npm run build on stripped copy', b.status === 0, b.status === 0 ? 'ok' : (b.stderr || b.stdout || '').slice(-400));
  const dist = path.join(out, 'dist');
  if (b.status === 0 && fs.existsSync(dist)) {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const distBad = [];
    for (const p of walk(dist)) {
      if (!/\.(html|js|css|mjs|map|txt|json)$/i.test(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      const rel = path.relative(dist, p);
      if (/@dev\b/.test(txt)) distBad.push(`${rel}: contains "@dev"`);
      if (p.endsWith('.html')) {
        for (const c of extractComments(txt, '.html')) {
          const h = matchPatterns(c.text);
          if (h.length) distBad.push(`${rel}:${c.line}: ${h.join(', ')}: ${c.text.trim().slice(0, 100)}`);
        }
      }
    }
    record('build output: no @dev, no internal references in HTML comments', distBad.length === 0, distBad.join(' | '));
  }
}

// report ------------------------------------------------------------------
console.log('');
if (violations.length) {
  console.log('Comment lines that would block promotion (file:line [pattern] text):');
  for (const v of violations) console.log(`  ${v.file}:${v.line} [${v.hits.join(', ')}] ${v.text}`);
  console.log('Fix: mark the line as an @dev comment, or rewrite it in plain engineering terms.\n');
}
if (msgViol.length) {
  console.log('Commit message problems:');
  for (const v of msgViol) console.log(`  line ${v.line} [${v.hits.join(', ')}] ${v.text}`);
  console.log('');
}
console.log('Gate results:');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
const ok = results.every((r) => r.ok);
console.log(`\nGATE: ${ok ? 'PASS' : 'FAIL'}${dryRun ? ' (dry-run: tests and build not run)' : ''}`);
if (flag('--keep-temp')) console.log(`Kept: ${tmp}`); else fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
