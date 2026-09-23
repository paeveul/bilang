// vite.config.mjs — Item 22 (React + Vite migration), Step 1, + Step 9's
// Preact alias (F11), + Step 12's cutover.
//
// Item 22 Step 12: index.html now IS the React app's entry (promoted from
// react-shell.dev.html, deleted this step) — the old vanilla client
// (js/app.js) is gone, so this config's default root-index.html entry
// builds the React app directly. No `build.rollupOptions.input` change
// was needed: Vite already defaulted to root `index.html` as its sole
// entry, and that file's own content is what changed, not this config.
// The Preact alias below still applies to whichever entry imports
// `react`, so it carries over unchanged.
//
// build.outDir is 'dist' per vercel.json's outputDirectory (F2, 22.3).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Item 22 Step 10 (§22.4, B1/F11): the production React bundle measured
// well over B1's ~60 KB gzipped budget against react-shell.dev.html
// (measured pre-alias with a scratch Vite config pointed at that entry —
// see bilang-mvp1-implementation-plans.md's Step 10 status note for the
// exact before/after numbers and methodology). F11's escape hatch, applied
// per the doc's own instruction ("apply the Preact alias and re-measure
// before proceeding — do not defer this"): alias every `react`/`react-dom`
// import to `preact/compat` at build time. Zero source-file changes
// anywhere else — every component still imports from 'react' and
// 'react-dom'; only what those specifiers RESOLVE TO changes.
const preactAlias = {
  react: 'preact/compat',
  'react-dom/test-utils': 'preact/test-utils',
  'react-dom': 'preact/compat',
  'react/jsx-runtime': 'preact/jsx-runtime',
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: preactAlias,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
