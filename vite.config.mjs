//
//
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const preactAlias = {
  react: 'preact/compat',
  'react-dom/test-utils': 'preact/test-utils',
  'react-dom': 'preact/compat',
  'react/jsx-runtime': 'preact/jsx-runtime',
};

// Internal HTML notes are written as whole-line marker comments (see
// scripts/README-promote-gate.md). They are removed from the built HTML on
// every branch, so they can never be served to a visitor. Plain HTML comments
// (such as the vendored-library notice) are left alone.
const stripDevHtmlComments = () => ({
  name: 'strip-dev-html-comments',
  transformIndexHtml: (html) => html.replace(/^[ \t]*<!--\s*@dev\b.*?-->[ \t]*\r?\n/gm, ''),
});

export default defineConfig({
  plugins: [react(), stripDevHtmlComments()],
  resolve: {
    alias: preactAlias,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
