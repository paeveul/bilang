// src/main.jsx — React entry point.
// Item 22 Step 12: wired into the shipped index.html now — the old
// vanilla client (js/app.js) is deleted and react-shell.dev.html (its
// dev-only home through Steps 2-11) is gone too, promoted into
// index.html directly (F3: one clean cut).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
