// src/test/register-jsx.mjs — registers ./jsx-loader.mjs via node:module's
// `register()` API (the current, non-deprecated way to add a custom ESM
// loader — the older `--loader` CLI flag prints a deprecation warning on
// Node 20+). Imported first via `node --import` in package.json's "test"
// script, before any test file, so every subsequent `import` of a `.jsx`
// file anywhere in the test run goes through the JSX transform.
import { register } from 'node:module';

register('./jsx-loader.mjs', import.meta.url);
