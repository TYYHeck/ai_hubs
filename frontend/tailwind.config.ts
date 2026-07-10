import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f0f0f',
          secondary: '#1a1a1a',
          tertiary: '#242424',
        },
        border: '#2a2a2a',
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'sans-serif'],
        mono: ['Consolas', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
