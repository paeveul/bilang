#!/usr/bin/env node
// Writes a copy of the working tree to --out with every whole-line `@dev`
// comment removed. The working tree is never modified, and the script refuses
// an --out folder inside the repository.
//
//   node scripts/strip-dev-comments.mjs [--out <dir-outside-the-repo>] [--list]
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTreeTo } from './lib/dev-comments.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const list = args.includes('--list');
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : fs.mkdtempSync(path.join(os.tmpdir(), 'bilang-strip-'));

const res = stripTreeTo(root, out);
const total = res.removedByFile.reduce((n, f) => n + f.removed.length, 0);
console.log(`Stripped copy written to: ${out}`);
console.log(`@dev lines removed: ${total} across ${res.removedByFile.length} file(s)`);
if (list) {
  for (const f of res.removedByFile) for (const r of f.removed) console.log(`  ${f.file}:${r.line}  ${r.content.trim()}`);
}
for (const w of res.warnings) console.log(`WARNING ${w}`);
