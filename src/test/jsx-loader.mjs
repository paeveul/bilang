// src/test/jsx-loader.mjs — Node custom ESM loader, added this pass so
// `node --test` can import a real .jsx file directly (ReviewScreen.jsx),
// which nothing in this codebase needed before: every prior component test
// (payer-item-row.security.test.mjs, bill-context-assignment.test.mjs)
// worked around the missing JSX transform either by testing a plain
// React.createElement file (payer-item-row.js) or a JSX-free reducer
// (bill-reducer.js) — see those files' own header comments for that
// precedent. Retrofitting Radix into ReviewScreen.jsx (real accordion
// keyboard behaviour, real focus-stealing on block) cannot be verified
// with renderToStaticMarkup — both need a live DOM and real focus, which
// means rendering the actual component tree, which means transforming its
// JSX for Node's own module loader.
//
// esbuild is already a devDependency of Vite's own build pipeline
// (transitively) — pinned here explicitly (package.json devDependencies)
// rather than relied on implicitly, since a test-time tool this load-bearing
// should be a declared dependency, not an accident of what Vite happens to
// pull in. Zero runtime/browser footprint: this file, and esbuild itself,
// are never part of `vite build`'s output.
//
// Registered via `node --import ./src/test/register-jsx.mjs --test ...`
// (see package.json's "test" script) rather than a `--loader` CLI flag,
// which Node has deprecated in favour of `module.register()`.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const path = fileURLToPath(url);
    const source = await readFile(path, 'utf8');
    const { code } = await esbuild.transform(source, {
      loader: 'jsx',
      jsx: 'automatic',
      jsxImportSource: 'react',
      format: 'esm',
      sourcefile: path,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
