/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Fiberlytic brand palette — gold
        brand: {
          50:  '#fef8e7',
          100: '#fdefc4',
          200: '#f9da8a',
          300: '#f3bf3e',
          400: '#e8a90e',
          500: '#c9920a',
          600: '#a87208',
          700: '#835907',
          800: '#604005',
          900: '#3e2a03',
          950: '#221602',
        },
        fiber: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
        // Explicit dark surface tokens
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
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
