/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /* chess board - cyan glass dark squares, crisp white light squares */
        board: { dark: 'rgba(25, 189, 242, 0.55)', light: '#FFFFFF' },
        ink: {
          950: 'var(--ink-950)', 900: 'var(--ink-900)', 800: 'var(--ink-800)',
          700: 'var(--ink-700)', 600: 'var(--ink-600)',
        },
        ivory: {
          50: 'var(--ivory-50)', 100: 'var(--ivory-100)', 200: 'var(--ivory-200)',
          300: 'var(--ivory-300)', 400: 'var(--ivory-400)', 500: 'var(--ivory-500)',
          600: 'var(--ivory-600)', 700: 'var(--ivory-700)', 800: 'var(--ivory-800)',
        },
        /* Brand accent. The ramp name is historical (it was cyan, then gold);
           the values are now the Tournaments blue ramp so every text-gold-*
           and bg-gold-* class in the app lands on a readable accent. */
        gold: {
          100: '#eff6ff', 200: '#dbeafe', 300: '#bfdbfe', 400: '#2563eb',
          500: '#1d4ed8', 600: '#1e40af', 700: '#1e3a8a',
        },
      },
      fontFamily: {
        display: ['Nunito', 'Quicksand', 'system-ui', 'sans-serif'],
        sans: ['Nunito', 'Quicksand', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};