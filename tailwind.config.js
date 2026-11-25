import { PALETTE } from './src/lib/palette.ts'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: PALETTE.base,
        surface: PALETTE.surface,
        line: PALETTE.line,
        content: PALETTE.content,
        muted: PALETTE.muted,
        buy: PALETTE.buy,
        sell: PALETTE.sell,
        warn: PALETTE.warn,
        accent: PALETTE.accent,
        accentText: PALETTE.accentText,
        info: PALETTE.info,
      },
      fontFamily: {
        display: ['Sora', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
