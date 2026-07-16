/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // FiberLytic brand palette — monochromatic (Obsidian/White scale)
        brand: {
          50:  '#ececec', // Cloud — exact page-background gray sampled from brand reference
          100: '#f0f0f0', // Mist
          200: '#e5e5e5', // Silver
          300: '#d4d4d4',
          400: '#a3a3a3',
          500: '#6b6b6b', // Body text
          600: '#525252',
          700: '#333333', // Charcoal
          800: '#1f1f1f',
          900: '#111111', // Obsidian
          950: '#0a0a0a',
        },
        // Accent used for links, progress, active states — brand guide's Info/Links semantic color
        fiber: {
          400: '#60a5fa',
          500: '#2563eb',
          600: '#1d4ed8',
        },
        // Semantic UI colors from the brand guide
        success: '#16a34a',
        danger: '#dc2626',
        warning: '#a16207',
        info: '#2563eb',
        // Explicit dark surface tokens (already aligned with Obsidian #111111)
        surface: {
          900: '#0a0a0a',
          800: '#111111',
          700: '#161616',
          600: '#1e1e1e',
          500: '#2a2a2a',
          400: '#383838',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
        heading: ['Instrument Sans', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
