export const PALETTE = {
  base: '#0A0B10',
  surface: '#12141C',
  content: '#F4F6FB',
  muted: '#8B92A8',
  buy: '#2BFFB0',
  sell: '#FF4D8D',
  warn: '#FFC53D',
  accent: '#7B5CFF',
  // Tom mais claro para texto pequeno sobre superfície escura (WCAG AA ≥ 4,5:1).
  accentText: '#9A86FF',
  info: '#28D7FF',
  white: '#FFFFFF',
  line: 'rgba(255, 255, 255, 0.06)',
} as const

export function withAlpha(hex: string, opacity: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const red = (value >> 16) & 0xff
  const green = (value >> 8) & 0xff
  const blue = value & 0xff

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}
