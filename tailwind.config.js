/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    // Item 22 Step 12: index.html is now the React app's own entry
    // (promoted from react-shell.dev.html, deleted this step) — one glob
    // covers it, no separate dev-shell entry needed any more.
    "./index.html",
    "./js/**/*.js",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
