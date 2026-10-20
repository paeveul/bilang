#!/usr/bin/env node
// Fast commit-time checks used by the git hooks in scripts/hooks/.
//
//   node scripts/check-staged.mjs                 checks what is STAGED for commit:
//                                                 no @dev lines, no internal references in comments
//   node scripts/check-staged.mjs --message <f>   checks a commit message file
//                                                 (internal references, AI attribution trailers)
//
// Exit 0 = clean, 1 = blocked. Read-only: never edits files or the index.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isScannable, extOf, stripDev, extractComments, matchPatterns } from './lib/dev-comments.mjs';

const argv = process.argv.slice(2);
const mi = argv.indexOf('--message');

function checkMessage(file) {
  const msg = fs.readFileSync(file, 'utf8');
  const problems = [];
  msg.split(/\r?\n/).forEach((l, i) => {
    if (l.startsWith('#')) return; // git comment lines
    const h = matchPatterns(l);
    if (h.length) problems.push(`  line ${i + 1} [${h.join(', ')}] ${l.slice(0, 140)}`);
  });
  if (/co-authored-by|claude-session|generated with|\bclaude\b/i.test(msg.replace(/^#.*$/gm, ''))) {
    problems.push('  AI attribution trailer present (Co-Authored-By / Claude-Session / "Generated with"). House rule: no such trailers in commits.');
  }
  return problems;
}

function checkStaged() {
  const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], { encoding: 'utf8' })
    .split('\0').filter(Boolean).filter(isScannable);
  const problems = [];
  for (const f of files) {
    const text = execFileSync('git', ['show', `:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const ext = extOf(f);
    const r = stripDev(text, ext);
    for (const x of r.removed) problems.push(`  ${f}:${x.line}  @dev note (local-only): ${x.content.trim().slice(0, 100)}`);
    for (const c of extractComments(text, ext)) {
      if (c.devMarked) continue;
      const hits = matchPatterns(c.text);
      if (hits.length) problems.push(`  ${f}:${c.line} [${hits.join(', ')}] ${c.text.trim().slice(0, 100)}`);
    }
  }
  return problems;
}

const problems = mi >= 0 ? checkMessage(path.resolve(argv[mi + 1])) : checkStaged();
if (problems.length) {
  console.error(mi >= 0 ? 'Commit message blocked:' : 'Commit blocked: staged files carry internal notes.');
  for (const p of problems.slice(0, 60)) console.error(p);
  if (problems.length > 60) console.error(`  ... and ${problems.length - 60} more`);
  if (mi < 0) console.error('\nFix: run  node scripts/archive-dev-notes.mjs  (moves @dev notes to the private archive), re-stage, and rewrite any remaining flagged comment in plain engineering terms.');
  process.exit(1);
}
console.log(mi >= 0 ? 'commit message: clean' : 'staged files: clean');
