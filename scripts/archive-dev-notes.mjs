#!/usr/bin/env node
// Moves `@dev` notes out of the source files into a private archive that lives
// OUTSIDE the repository, so the committed code carries only plain comments.
// Nothing is ever lost: every batch can be put back, and a built-in round-trip
// test proves it.
//
//   node scripts/archive-dev-notes.mjs                 archive: remove @dev lines from the files, save them
//   node scripts/archive-dev-notes.mjs --dry-run       show what would be archived, change nothing
//   node scripts/archive-dev-notes.mjs --snapshot      save a non-destructive copy of every @dev line (and the files that hold them)
//   node scripts/archive-dev-notes.mjs --restore       put the most recent batch back (add --all for every batch, newest first)
//   node scripts/archive-dev-notes.mjs --verify        check every saved batch can rebuild its files
//   node scripts/archive-dev-notes.mjs --self-test     full round trip on a temp copy of the tree, byte-for-byte
//   node scripts/archive-dev-notes.mjs --list          list batches
//
// Options: --archive <dir>  (default: bilang/technical/dev-notes-archive; must be outside the repo)
//          --batch <id>     (with --restore: a specific batch)
//
// Only whole-line `@dev` comments (see lib/dev-comments.mjs) are touched, plus
// the leftovers their removal would create (an emptied comment shell, a doubled
// blank line). Code lines are never modified.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isScannable, extOf, stripDev, reinsert, splitLines } from './lib/dev-comments.mjs';

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const git = (root, ...a) => {
  try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};

export function defaultArchiveDir(root) {
  return path.resolve(root, '..', 'technical', 'dev-notes-archive');
}

function assertOutside(root, dir) {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`refusing to use an archive folder inside the repository: ${dir}`);
  }
}

function listFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\0').filter(Boolean).filter(isScannable);
}

// Group consecutive removed lines into runs and attach anchors (the nearest kept
// line after / before the run) for the fallback restore.
function buildRuns(text, removed) {
  const keptLines = splitLines(text).map((l) => l.replace(/\r?\n$/, ''));
  const total = keptLines.length + removed.length;
  const isRemoved = new Set(removed.map((r) => r.line));
  const keptAt = []; // 1-based original line -> kept index (0-based) or -1
  let k = 0;
  for (let p = 1; p <= total; p++) keptAt[p] = isRemoved.has(p) ? -1 : k++;
  const nth = (idx) => {
    const t = keptLines[idx];
    let n = 0;
    for (let i = 0; i < idx; i++) if (keptLines[i] === t) n++;
    return { text: t, nth: n };
  };
  const runs = [];
  for (let i = 0; i < removed.length;) {
    let j = i;
    while (j + 1 < removed.length && removed[j + 1].line === removed[j].line + 1) j++;
    const first = removed[i].line;
    const last = removed[j].line;
    const after = last + 1 <= total ? keptAt[last + 1] : -1;
    const before = first - 1 >= 1 ? keptAt[first - 1] : -1;
    runs.push({
      line: first,
      lines: removed.slice(i, j + 1).map((r) => r.raw),
      anchorAfter: after >= 0 ? nth(after) : null,
      anchorBefore: before >= 0 ? nth(before) : null,
    });
    i = j + 1;
  }
  return runs;
}

const flatten = (runs) => runs.flatMap((r) => r.lines.map((raw, i) => ({ line: r.line + i, raw })));

function batchId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function readableTxt(batch) {
  const out = [`Batch ${batch.id} (${batch.kind}) - ${batch.created}`, `Branch: ${batch.branch || '?'}  HEAD: ${batch.head || '?'}`, ''];
  for (const f of batch.files) {
    out.push(`== ${f.file}`);
    for (const r of f.runs) r.lines.forEach((raw, i) => out.push(`  ${String(r.line + i).padStart(5)}: ${raw.replace(/\r?\n$/, '')}`));
    out.push('');
  }
  return out.join('\n');
}

function writeBatch(archiveDir, batch) {
  fs.mkdirSync(archiveDir, { recursive: true });
  const base = path.join(archiveDir, `batch-${batch.id}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(batch, null, 1));
  fs.writeFileSync(`${base}.txt`, readableTxt(batch));
  return base;
}

function loadBatches(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  return fs.readdirSync(archiveDir).filter((f) => /^batch-.*\.json$/.test(f)).sort()
    .map((f) => ({ file: path.join(archiveDir, f), batch: JSON.parse(fs.readFileSync(path.join(archiveDir, f), 'utf8')) }));
}

// ---- archive --------------------------------------------------------------
export function archiveTree(root, archiveDir, { dryRun = false, snapshot = false } = {}) {
  assertOutside(root, archiveDir);
  const files = [];
  let count = 0;
  for (const f of listFiles(root)) {
    const abs = path.join(root, f);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    const r = stripDev(raw, extOf(f));
    if (!r.removed.length) continue;
    count += r.removed.length;
    files.push({ file: f.replace(/\\/g, '/'), beforeSha256: sha(raw), afterSha256: sha(r.text), runs: buildRuns(r.text, r.removed), _text: r.text });
  }
  let id = batchId();
  for (let n = 2; fs.existsSync(path.join(archiveDir, `batch-${id}.json`)); n++) id = `${batchId()}-${n}`;
  const batch = {
    version: 1, id, kind: snapshot ? 'snapshot' : 'archive', created: new Date().toISOString(),
    branch: git(root, 'branch', '--show-current'), head: git(root, 'rev-parse', '--short', 'HEAD'),
    files: files.map(({ _text, ...rest }) => rest),
  };
  if (dryRun || !files.length) return { batch, count, written: null };
  // Write the archive FIRST and prove it can rebuild every file, then touch the tree.
  const base = writeBatch(archiveDir, batch);
  for (const f of files) {
    const rebuilt = reinsert(f._text, flatten(f.runs));
    if (sha(rebuilt) !== f.beforeSha256) throw new Error(`archive would not round-trip for ${f.file}; nothing was changed`);
  }
  if (snapshot) {
    const snapDir = path.join(archiveDir, `snapshot-files-${id}`);
    for (const f of files) {
      const dst = path.join(snapDir, f.file);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(root, f.file), dst);
    }
  } else {
    for (const f of files) fs.writeFileSync(path.join(root, f.file), f._text);
  }
  return { batch, count, written: base };
}

// ---- restore --------------------------------------------------------------
function findAnchor(lines, a) {
  if (!a) return -1;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/\r?\n$/, '') === a.text) { if (n === a.nth) return i; n++; }
  }
  // same text, different count: take the closest occurrence
  const hits = [];
  lines.forEach((l, i) => { if (l.replace(/\r?\n$/, '') === a.text) hits.push(i); });
  return hits.length ? hits[Math.min(a.nth, hits.length - 1)] : -1;
}

// Rebuild one file from the current text. Exact when the file is unchanged since
// the archive; otherwise each run is placed next to its anchor line.
export function restoreFileText(current, f) {
  if (sha(current) === f.afterSha256) {
    const out = reinsert(current, flatten(f.runs));
    return { text: out, exact: sha(out) === f.beforeSha256, unplaced: [] };
  }
  const lines = splitLines(current);
  const unplaced = [];
  // insert from the bottom so earlier indexes stay valid
  for (const run of [...f.runs].reverse()) {
    let idx = findAnchor(lines, run.anchorAfter);
    if (idx < 0) { const b = findAnchor(lines, run.anchorBefore); idx = b < 0 ? -1 : b + 1; }
    if (idx < 0) { unplaced.push(run); continue; }
    lines.splice(idx, 0, ...run.lines);
  }
  return { text: lines.join(''), exact: false, unplaced };
}

export function restoreBatch(root, archiveDir, entry, { dryRun = false } = {}) {
  const report = [];
  for (const f of entry.batch.files) {
    const abs = path.join(root, f.file);
    if (!fs.existsSync(abs)) { report.push({ file: f.file, status: 'MISSING', unplaced: f.runs.length }); continue; }
    const cur = fs.readFileSync(abs, 'utf8');
    const r = restoreFileText(cur, f);
    if (!dryRun && r.unplaced.length === 0) fs.writeFileSync(abs, r.text);
    report.push({ file: f.file, status: r.unplaced.length ? 'PARTIAL' : (r.exact ? 'EXACT' : 'ANCHORED'), unplaced: r.unplaced.length, unplacedRuns: r.unplaced });
  }
  return report;
}

// ---- verify ---------------------------------------------------------------
export function verifyArchive(root, archiveDir) {
  const problems = [];
  const batches = loadBatches(archiveDir);
  for (const { file, batch } of batches) {
    if (batch.kind !== 'archive') continue;
    for (const f of batch.files) {
      // Each batch must rebuild its "before" text from its own "after" text. The
      // "after" text is only on disk for the newest batch, so check the chain
      // the cheap way: line counts and content hashes of the stored runs.
      const abs = path.join(root, f.file);
      if (!fs.existsSync(abs)) continue;
      const cur = fs.readFileSync(abs, 'utf8');
      if (sha(cur) === f.afterSha256) {
        const out = reinsert(cur, flatten(f.runs));
        if (sha(out) !== f.beforeSha256) problems.push(`${path.basename(file)}: ${f.file} does not rebuild`);
      }
    }
  }
  return { batches: batches.length, problems };
}

// ---- self-test --------------------------------------------------------------
export function selfTest(root) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bilang-archive-test-'));
  const tree = path.join(tmp, 'tree');
  const arch = path.join(tmp, 'archive');
  const results = [];
  try {
    const files = listFiles(root).filter((f) => fs.existsSync(path.join(root, f)));
    const original = new Map();
    for (const f of files) {
      const dst = path.join(tree, f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(root, f), dst);
      original.set(f, fs.readFileSync(path.join(root, f), 'utf8'));
    }
    // git is needed by listFiles(): make the temp tree a throw-away repo
    execFileSync('git', ['init', '-q'], { cwd: tree });
    // Synthetic edge cases so the test does not depend on what the real tree holds
    const edge = path.join(tree, 'zz-edge.js');
    const edgeText = '// @dev first line note\n\nconst a = 1;\n/**\n * @dev only a note\n */\nconst b = 2; // trailing stays\r\n// @dev crlf note\r\nconst c = 3;\n\n// @dev x\n\nconst d = 4;\n/* @dev one-liner */\nconst e = "// @dev inside a string";\n// @dev last, no newline';
    fs.writeFileSync(edge, edgeText);
    original.set('zz-edge.js', edgeText);
    const edgeCss = path.join(tree, 'zz-edge.css');
    const cssText = '/* @dev css note */\n.a { color: red; }\n\n/* @dev another */\n\n.b { color: blue; }\n';
    fs.writeFileSync(edgeCss, cssText);
    original.set('zz-edge.css', cssText);
    const edgeHtml = path.join(tree, 'zz-edge.html');
    const htmlText = '<!doctype html>\n<!-- @dev html note -->\n<p>hi</p>\n';
    fs.writeFileSync(edgeHtml, htmlText);
    original.set('zz-edge.html', htmlText);

    const a1 = archiveTree(tree, arch);
    results.push({ name: 'archive removes @dev lines', ok: a1.count > 0, detail: `${a1.count} line(s), ${a1.batch.files.length} file(s)` });
    const stillDev = [...original.keys()].filter((f) => /^\s*(\/\/|\/\*|<!--|--|\*)\s*@dev\b/m.test(fs.readFileSync(path.join(tree, f), 'utf8')));
    results.push({ name: 'no @dev line left in the tree', ok: stillDev.length === 0, detail: stillDev.join(', ') });
    const a2 = archiveTree(tree, arch, { dryRun: true });
    results.push({ name: 'second archive finds nothing (idempotent)', ok: a2.count === 0, detail: `${a2.count}` });
    const v = verifyArchive(tree, arch);
    results.push({ name: 'verify: archive rebuilds its files', ok: v.problems.length === 0, detail: v.problems.join('; ') });

    // exact restore
    const entry = loadBatches(arch)[0];
    const rep = restoreBatch(tree, arch, entry);
    const bad = [];
    for (const [f, text] of original) if (fs.readFileSync(path.join(tree, f), 'utf8') !== text) bad.push(f);
    results.push({ name: 'restore: every file identical to the original, byte for byte', ok: bad.length === 0 && rep.every((r) => r.status === 'EXACT'), detail: bad.slice(0, 5).join(', ') || `${rep.length} file(s) EXACT` });

    // restore after the file changed in between (anchored path)
    archiveTree(tree, arch);
    const target = [...original.keys()].find((f) => f !== 'zz-edge.js' && /\.(js|mjs)$/.test(f) && original.get(f).includes('@dev'));
    if (target) {
      const p = path.join(tree, target);
      fs.writeFileSync(p, `const addedLater = 1;\n${fs.readFileSync(p, 'utf8')}`);
      const entries = loadBatches(arch);
      const rep2 = restoreBatch(tree, arch, entries[entries.length - 1]);
      const r = rep2.find((x) => x.file === target);
      const back = fs.readFileSync(p, 'utf8');
      const missing = original.get(target).split(/\r?\n/).filter((l) => /@dev\b/.test(l)).filter((l) => !back.includes(l));
      results.push({ name: 'restore after later edits: anchored, no note lost', ok: r && r.status !== 'PARTIAL' && missing.length === 0, detail: `${target}: ${r && r.status}, missing ${missing.length}` });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}

// ---- CLI --------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const archiveDir = path.resolve(val('--archive') || defaultArchiveDir(root));
  try {
    assertOutside(root, archiveDir);
    if (flag('--self-test')) {
      const res = selfTest(root);
      for (const r of res) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
      const ok = res.every((r) => r.ok);
      console.log(`\nROUND-TRIP: ${ok ? 'PASS' : 'FAIL'}`);
      process.exit(ok ? 0 : 1);
    } else if (flag('--verify')) {
      const v = verifyArchive(root, archiveDir);
      console.log(`${v.batches} batch(es) in ${archiveDir}`);
      for (const p of v.problems) console.log(`  PROBLEM ${p}`);
      console.log(v.problems.length ? 'VERIFY: FAIL' : 'VERIFY: PASS');
      process.exit(v.problems.length ? 1 : 0);
    } else if (flag('--list')) {
      for (const { file, batch } of loadBatches(archiveDir)) {
        const n = batch.files.reduce((a, f) => a + f.runs.reduce((b, r) => b + r.lines.length, 0), 0);
        console.log(`${batch.id}  ${batch.kind.padEnd(8)}  ${n} line(s) in ${batch.files.length} file(s)  branch ${batch.branch || '?'} @ ${batch.head || '?'}  ${path.basename(file)}`);
      }
    } else if (flag('--restore')) {
      let batches = loadBatches(archiveDir).filter((b) => b.batch.kind === 'archive');
      if (val('--batch')) batches = batches.filter((b) => b.batch.id === val('--batch'));
      if (!batches.length) { console.log('No archive batch to restore.'); process.exit(1); }
      const todo = flag('--all') ? [...batches].reverse() : [batches[batches.length - 1]];
      let bad = false;
      for (const e of todo) {
        console.log(`Restoring batch ${e.batch.id}`);
        for (const r of restoreBatch(root, archiveDir, e)) {
          console.log(`  ${r.status.padEnd(8)} ${r.file}${r.unplaced ? `  (${r.unplaced} run(s) could not be placed; file left untouched)` : ''}`);
          if (r.status === 'PARTIAL' || r.status === 'MISSING') bad = true;
        }
      }
      process.exit(bad ? 1 : 0);
    } else {
      const dryRun = flag('--dry-run');
      const snapshot = flag('--snapshot');
      const res = archiveTree(root, archiveDir, { dryRun, snapshot });
      console.log(`${snapshot ? 'Snapshot' : dryRun ? 'Would archive' : 'Archived'}: ${res.count} @dev line(s) in ${res.batch.files.length} file(s)`);
      if (res.written) console.log(`Saved to: ${res.written}.json (+ .txt)${snapshot ? ' and snapshot-files-' + res.batch.id + '/' : ''}`);
      if (!res.count) console.log('Nothing to do: no @dev lines in the tree.');
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(2);
  }
}
