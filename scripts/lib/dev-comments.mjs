// Shared helpers for the promote gate and the @dev stripper.
//
// Convention: an internal note is written as a WHOLE-LINE comment whose text
// starts with `@dev`. Plain explanatory comments carry no marker and stay on
// every branch. Only whole `@dev` lines are ever deleted; code is never parsed
// or rewritten.
//
//   // @dev ...            JS / JSX / MJS
//   /* @dev ... */        JS / CSS (single line)
//   {/* @dev ... */}      JSX children
//   <!-- @dev ... -->     HTML (single line)
//   -- @dev ...           SQL
//    * @dev ...           inside a /* ... */ block (JSDoc style)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const CODE_EXT = new Set(['.js', '.mjs', '.jsx', '.css', '.html', '.sql']);

// Files the scanner/stripper leaves alone: the tooling itself (it must name the
// patterns), vendored third-party code, and generated lockfiles.
export const EXEMPT = [
  /^scripts\/promote-gate\.mjs$/,
  /^scripts\/strip-dev-comments\.mjs$/,
  /^scripts\/archive-dev-notes\.mjs$/,
  /^scripts\/check-staged\.mjs$/,
  /^scripts\/lib\//,
  /^js\/vendor\//,
  /^package-lock\.json$/,
];

export function extOf(p) {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i).toLowerCase();
}

export function isScannable(rel) {
  return CODE_EXT.has(extOf(rel)) && !EXEMPT.some((re) => re.test(rel));
}

// ---- Case 20 patterns: internal-reference comments ----------------------
// Deliberately over-eager. A false alarm goes to a human; the gate never edits.
const NAMES = '(?:Alex|Tony|Howard|Amelia|Javier|Jenny|Gwen|Gwendolen|Dylan|Celia|Wally)';
export const PATTERNS = [
  ['plan/section reference', /(?:\bplans?\s+(?:doc(?:ument)?\s+)?(?:section\s+)?(?:§\s*)?\d+\.\d+|\bsection\s+\d+\.\d+|§\s*\d|\bverification\s+#?\d+|\bbilang-[a-z0-9-]+\.md)/i],
  ['standing-rule / open-question reference', /\bStanding Rule\b|\bOQ-?\d+\b|\bOpen (?:Item|Question)\b/i],
  ['tracker reference', /\b(?:pm-?tracker|tracker\b|change-?log)/i],
  ['item/step/checkpoint tag', /\b(?:Item\s+\d+|Step\s+\d+|Checkpoint\s*\d+|Steps\s+\d+)/],
  ['decision/plan id', /\b(?:D\d{1,2}(?:-\d+)?|SM\d+|F\d{1,2}[a-z]?|B\d|Q\d{1,2}|W\d{1,2}|R-?\d{1,2}|roadmap|design spec)\b/i],
  ['attribution / relay', /\b(?:coordinator|relayed|per\s+instruction|flagged\s+for|instruction\s+of)\b/i],
  ['personal name', new RegExp(`\\b${NAMES}(?:'s)?\\b`)],
  ['internal date', /\b20\d\d-\d\d-\d\d\b/],
];

// Legitimate text that would otherwise trip a pattern.
const FALSE_POSITIVE = [/01 Jan 1970/g];

export function matchPatterns(text) {
  for (const re of FALSE_POSITIVE) text = text.replace(re, '');
  const hits = [];
  for (const [label, re] of PATTERNS) if (re.test(text)) hits.push(label);
  return hits;
}

// ---- Comment extraction (line based, over-eager) ------------------------
const DEV = '@dev\\b';
const DEV_RES = {
  js: [
    new RegExp(`^\\s*//\\s*${DEV}`),
    new RegExp(`^\\s*/\\*+\\s*${DEV}.*\\*/\\s*$`),
    new RegExp(`^\\s*\\{\\s*/\\*+\\s*${DEV}.*\\*/\\s*\\}\\s*$`),
  ],
  html: [new RegExp(`^\\s*<!--\\s*${DEV}.*-->\\s*$`)],
  sql: [new RegExp(`^\\s*--\\s*${DEV}`), new RegExp(`^\\s*/\\*+\\s*${DEV}.*\\*/\\s*$`)],
  css: [new RegExp(`^\\s*/\\*+\\s*${DEV}.*\\*/\\s*$`)],
};
const DEV_BLOCK_INNER_RE = new RegExp(`^\\s*\\*\\s*${DEV}`);

function family(ext) {
  if (ext === '.html') return 'html';
  if (ext === '.sql') return 'sql';
  if (ext === '.css') return 'css';
  return 'js';
}

// True when the whole line is an @dev marker line. `inBlock` = the line sits
// inside a multi-line block comment (JSDoc style ` * @dev ...` lines).
export function isDevLine(line, inBlock, ext = '.js') {
  const fam = family(ext);
  if (DEV_RES[fam].some((re) => re.test(line))) return true;
  if (inBlock && fam !== 'html' && DEV_BLOCK_INNER_RE.test(line) && !line.includes('*/')) return true;
  return false;
}

// Returns [{ line (1-based), text, devMarked }]. `text` is the comment text on
// that line only.
export function extractComments(source, ext) {
  const lines = source.split(/\r?\n/);
  const out = [];
  const fam = family(ext);
  let inBlock = false;
  const openRe = fam === 'html' ? /<!--/ : /\/\*/;
  const closeRe = fam === 'html' ? /-->/ : /\*\//;
  const openLen = fam === 'html' ? 4 : 2;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dev = isDevLine(line, inBlock, ext);
    let text = null;
    if (inBlock) {
      text = line;
      if (closeRe.test(line)) inBlock = false;
    } else {
      const o = line.search(openRe);
      if (o >= 0) {
        text = line.slice(o);
        if (!closeRe.test(line.slice(o + openLen))) inBlock = true;
      } else if (fam === 'sql') {
        const m = line.match(/--\s?(.*)$/);
        if (m) text = m[1];
      } else if (fam === 'js') {
        // `//` that is not part of a URL scheme (https://) or a quoted path.
        const m = line.match(/(?:^|[^:'"`\\/])\/\/\s?(.*)$/);
        if (m) text = m[1];
      }
    }
    if (text !== null) out.push({ line: i + 1, text, devMarked: dev });
  }
  return out;
}

// ---- Stripper -----------------------------------------------------------
// Removes whole @dev lines only, plus the leftovers that removal would create:
// an emptied `/* */` block shell and a doubled blank line. Line terminators are
// kept exactly as they are, so a file that has nothing to strip is returned
// byte-for-byte. Returns { text, removed: [{line, content, raw}], warnings }.
// `content` is the removed line WITHOUT its terminator, `raw` WITH it; `line` is
// 1-based in the original file; `removed` is in ascending line order.
export function splitLines(source) {
  return source.match(/[^\n]*\n|[^\n]+$/g) || [];
}
const bare = (l) => l.replace(/\r?\n$/, '');
const isBlank = (l) => bare(l).trim() === '';

export function stripDev(source, ext) {
  const lines = splitLines(source);
  const fam = family(ext);
  const openRe = fam === 'html' ? /<!--/ : /\/\*/;
  const closeRe = fam === 'html' ? /-->/ : /\*\//;
  const openLen = fam === 'html' ? 4 : 2;
  const drop = new Array(lines.length).fill(false);
  let inBlock = false;
  let any = false;
  for (let i = 0; i < lines.length; i++) {
    const line = bare(lines[i]);
    if (isDevLine(line, inBlock, ext)) { drop[i] = true; any = true; continue; }
    if (inBlock) {
      if (closeRe.test(line)) inBlock = false;
    } else {
      const o = line.search(openRe);
      if (o >= 0 && !closeRe.test(line.slice(o + openLen))) inBlock = true;
    }
  }
  if (!any) return { text: source, removed: [], warnings: [] };

  if (fam !== 'html') {
    // An emptied block shell: `/*` or `/**` alone, then only ` *` / blank lines
    // (at least one of them dropped), then `*/` alone.
    for (let i = 0; i < lines.length; i++) {
      if (drop[i] || !/^\s*\/\*+\s*$/.test(bare(lines[i]))) continue;
      let j = i + 1;
      let sawDrop = false;
      while (j < lines.length && (drop[j] || (/^\s*\*?\s*$/.test(bare(lines[j])) && !/\*\//.test(lines[j])))) {
        if (drop[j]) sawDrop = true;
        j++;
      }
      if (sawDrop && j < lines.length && !drop[j] && /^\s*\*+\/\s*$/.test(bare(lines[j]))) {
        for (let k = i; k <= j; k++) drop[k] = true;
        i = j;
      }
    }
  }
  // Doubled blank line: a dropped run sitting between two blank lines (or at
  // the very top of the file) also takes one of the blanks with it.
  for (let i = 0; i < lines.length; i++) {
    if (!drop[i]) continue;
    let j = i;
    while (j + 1 < lines.length && drop[j + 1]) j++;
    const before = i === 0 ? true : (!drop[i - 1] && isBlank(lines[i - 1]));
    const after = j + 1 < lines.length && !drop[j + 1] && isBlank(lines[j + 1]);
    if (before && after) drop[j + 1] = true;
    i = j;
  }
  const keep = [];
  const removed = [];
  for (let i = 0; i < lines.length; i++) {
    if (drop[i]) removed.push({ line: i + 1, content: bare(lines[i]), raw: lines[i] });
    else keep.push(lines[i]);
  }
  const text = keep.join('');
  const warnings = [];
  if (/\/\*\*?[ \t]*\r?\n[ \t]*\*\//.test(text)) {
    warnings.push('an empty /* */ block was left behind after stripping');
  }
  return { text, removed, warnings };
}

// Put removed lines back at their original line numbers. Exact inverse of
// stripDev when `keptText` is the text stripDev returned.
export function reinsert(keptText, removed) {
  const kept = splitLines(keptText);
  const out = [];
  let k = 0;
  let r = 0;
  const total = kept.length + removed.length;
  for (let pos = 1; pos <= total; pos++) {
    if (r < removed.length && removed[r].line === pos) out.push(removed[r++].raw);
    else out.push(kept[k++] ?? '');
  }
  return out.join('');
}

// ---- Copy the working tree to a temp dir with @dev lines removed ---------
// Never writes into `root`. Throws if `outDir` is inside `root`.
export function stripTreeTo(root, outDir) {
  const rootAbs = path.resolve(root);
  const outAbs = path.resolve(outDir);
  const rel = path.relative(rootAbs, outAbs);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`refusing to write inside the working tree: ${outAbs}`);
  }
  fs.mkdirSync(outAbs, { recursive: true });
  const files = execFileSync('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard'], {
    cwd: rootAbs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  const removedByFile = [];
  const warnings = [];
  for (const f of files) {
    const src = path.join(rootAbs, f);
    if (!fs.existsSync(src)) continue; // tracked but deleted in the working tree
    const dst = path.join(outAbs, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (isScannable(f)) {
      const raw = fs.readFileSync(src, 'utf8');
      const r = stripDev(raw, extOf(f));
      if (r.removed.length) {
        removedByFile.push({ file: f, removed: r.removed });
        for (const w of r.warnings) warnings.push(`${f}: ${w}`);
        fs.writeFileSync(dst, r.text); // a leading BOM stays in the text as U+FEFF
      } else {
        fs.copyFileSync(src, dst); // byte-exact when there is nothing to strip
      }
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  return { files, removedByFile, warnings };
}
