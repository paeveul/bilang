# Promote gate, `@dev` notes and the private archive

The GitHub repo is public, so internal notes (plan or section numbers, tracker references, Item / Step / Checkpoint tags, decision ids, names, dates) must never be committed, on any branch. While working you may still write them as **whole-line `@dev` comments**. Before a commit they are moved to a private archive outside the repo, and the code keeps only plain, production-standard comments. The archive lives in a private folder outside the repository.

## The workflow

| Step | Command (run in `bilang/main/`) |
|---|---|
| 1. Work. Internal notes go in `@dev` lines; explanations a reviewer would find useful go in plain comments with no names, dates or plan numbers. | |
| 2. Before committing: move the notes out. | `node scripts/archive-dev-notes.mjs` |
| 3. Check what would be committed. | `node scripts/promote-gate.mjs --committed` (add `--message "text"` to check the commit message) |
| 4. Commit. The hooks (if installed) re-check. | |

## Marker forms

| Language | Form |
|---|---|
| JS / JSX / MJS | `// @dev ...` |
| JSX children | `{/* @dev ... */}` |
| CSS | `/* @dev ... */` (single line) |
| HTML | `<!-- @dev ... -->` (single line) |
| SQL | `-- @dev ...` |
| Inside a `/* */` block | ` * @dev ...` on its own line |

Whole line only. A trailing comment after code cannot be marked: put it on its own `@dev` line above the code, or rewrite it plainly.

When a comment mixes a useful "why" with internal references, split it: the "why" stays as a plain comment, and a short `@dev` line carries the plan, decision and date references.

## Commands

| Command | What it does |
|---|---|
| `node scripts/archive-dev-notes.mjs` | Removes every `@dev` line (plus the empty comment shell or doubled blank line it would leave) from the files and saves them as a new batch in a private folder outside the repository (default: `../technical/dev-notes-archive/` relative to the repo root). Proves the batch rebuilds each file byte for byte before touching anything. Code lines are never modified. |
| `node scripts/archive-dev-notes.mjs --dry-run` | Shows what would be archived. Changes nothing. |
| `node scripts/archive-dev-notes.mjs --snapshot` | Saves a non-destructive copy of every `@dev` line and of the files that hold them. |
| `node scripts/archive-dev-notes.mjs --restore` | Puts the most recent batch back (`--all`: every batch, newest first; `--batch <id>`: one batch). Exact when the file is unchanged since; otherwise each note is placed next to its neighbouring code line. A file where a note cannot be placed is left untouched and reported. |
| `node scripts/archive-dev-notes.mjs --verify` / `--list` | Checks the saved batches / lists them. |
| `node scripts/archive-dev-notes.mjs --self-test` | Round-trip test on a temp copy of the whole tree plus edge cases. Expect `ROUND-TRIP: PASS`. |
| `node scripts/promote-gate.mjs --committed` | Full gate for a tree that is about to be committed or pushed: no `@dev` line at all, no internal reference in any comment, `npm test` and `npm run build` on a temp copy, built output checked. |
| `node scripts/promote-gate.mjs --dry-run` | Scan only (no tests, no build). Without `--committed`, `@dev` lines are tolerated: they are stripped in the temp copy before the scan. |
| `node scripts/promote-gate.mjs --message "text"` or `--message @file` | Also checks a proposed commit message (internal references; AI attribution trailers). |
| `node scripts/promote-gate.mjs --verbose` / `--keep-temp` | Lists every `@dev` line that would be removed / keeps the temp copy. |
| `node scripts/strip-dev-comments.mjs [--out <dir>] [--list]` | Writes a stripped copy only. Refuses a folder inside the repository. |
| `node scripts/check-staged.mjs` / `--message <file>` | Fast checks on the staged files / a commit message file. Used by the hooks. |

## Hooks and GitHub Action (ready, not switched on)

| Piece | Where | To switch on |
|---|---|---|
| `pre-commit`: blocks staged `@dev` lines and internal references | `scripts/hooks/` | `git config core.hooksPath scripts/hooks` (once per clone) |
| `commit-msg`: blocks internal references and AI attribution trailers | `scripts/hooks/` | same |
| `pre-push`: runs the scan with `--committed` before anything leaves the machine | `scripts/hooks/` | same |
| GitHub Action `promote-gate`: gate on every push and pull request, every branch | `.github/workflows/promote-gate.yml` | Commit and push it. Making it a required check on `main` and `pre-prod` is a GitHub settings step. |

## Standing rule: no AI trailers

No `Co-Authored-By` or `Claude-Session` trailer (and no "Generated with" line) in any commit message or pull-request text. The gate, the commit-msg hook and the Action reject them. Eight old commits carry them and stay as they are.

## Safety properties

- `promote-gate.mjs` and `strip-dev-comments.mjs` never modify the working tree; all output goes to a temp folder outside the repository.
- `archive-dev-notes.mjs` is the only script that edits the working tree, and only by deleting whole `@dev` lines and the leftovers described above. It writes and checks the archive first. It refuses an archive folder inside the repo.
- The scan is deliberately over-eager. A false alarm goes to a human; the gate never edits.
- Files not scanned: this tooling (`scripts/promote-gate.mjs`, `strip-dev-comments.mjs`, `archive-dev-notes.mjs`, `check-staged.mjs`, `lib/`), `js/vendor/`, `package-lock.json`, and any file type other than `.js .mjs .jsx .css .html .sql`. Files such as `.gitignore` are not scanned.
- `<!-- @dev ... -->` lines are also removed from built HTML on every branch (see `vite.config.mjs`).

## Patterns the gate looks for in comments

Plan or section references (`plans 10.3`, `§5.1`, `bilang-*.md`), tracker references, `Item N` / `Step N` / `Checkpoint N`, decision ids (`D4`, `SM7`, `Q3`, `W18`, `R-1`), "Standing Rule", "Open Item / Open Question" and `OQ-n`, attributions (`coordinator`, `relayed`, `flagged for`), agent or owner names, and dates in `YYYY-MM-DD` form. The list lives in `scripts/lib/dev-comments.mjs` (`PATTERNS`).

## Not done yet

Branch creation (`dev`, `testing`, `pre-prod`), installing the hooks, enabling the Action as a required check, and the Vercel Ignored Build Step are separate, separately approved steps.
