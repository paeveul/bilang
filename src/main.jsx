// src/main.jsx — React entry point. Not wired into the shipped
// index.html yet — the old vanilla client (js/app.js) stays live in
// production through Step 11; the old client is only deleted at Step 12
// (F3: one clean cut). This entry is exercised via the dev-only
// react-shell.dev.html during Steps 2-11 — see that file's header comment.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
