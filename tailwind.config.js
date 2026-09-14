/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./js/**/*.js",
    // Item 22: the new React app (not yet shipped — see src/main.jsx and
    // react-shell.dev.html's header comments) so its Tailwind classes are
    // covered once it's wired into production at Step 12.
    "./react-shell.dev.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
