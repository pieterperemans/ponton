/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        ink: { DEFAULT: '#0f172a', soft: '#475569', faint: '#94a3b8' },
        accent: { DEFAULT: '#4f46e5', soft: '#eef2ff' },
      },
      boxShadow: { card: '0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06)' },
    },
  },
  plugins: [],
};
