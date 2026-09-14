// vite.config.js — Item 22 (React + Vite migration), Step 1.
//
// Nothing is migrated to React yet at this step — this config only wires
// Vite into the existing static index.html so the toolchain can be proven
// byte-equivalent before any screen is touched. React/Vite entry points
// (main.jsx, App.jsx, etc.) land in Steps 2+.
//
// build.outDir is 'dist' per vercel.json's outputDirectory (F2, 22.3).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
