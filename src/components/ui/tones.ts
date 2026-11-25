import { PALETTE, withAlpha } from '../../lib/palette'
import type { SignalTone } from '../../lib/signalMeta'

export interface ToneClasses {
  text: string
  chip: string
  border: string
  glow: string
  stroke: string
  soft: string
}

export const SIGNAL_TONES: Record<SignalTone, ToneClasses> = {
  buy: {
    text: 'text-buy',
    chip: 'border-buy/30 bg-buy/[0.08] text-buy',
    border: 'border-buy/35',
    glow: withAlpha(PALETTE.buy, 0.18),
    stroke: PALETTE.buy,
    soft: 'bg-buy/10',
  },
  sell: {
    text: 'text-sell',
    chip: 'border-sell/30 bg-sell/[0.08] text-sell',
    border: 'border-sell/35',
    glow: withAlpha(PALETTE.sell, 0.18),
    stroke: PALETTE.sell,
    soft: 'bg-sell/10',
  },
  warn: {
    text: 'text-warn',
    chip: 'border-warn/30 bg-warn/[0.08] text-warn',
    border: 'border-warn/30',
    glow: withAlpha(PALETTE.warn, 0.14),
    stroke: PALETTE.warn,
    soft: 'bg-warn/10',
  },
  idle: {
    text: 'text-content',
    chip: 'border-line bg-white/[0.03] text-muted',
    border: 'border-line',
    glow: withAlpha(PALETTE.accent, 0.12),
    stroke: PALETTE.accentText,
    soft: 'bg-white/[0.04]',
  },
  info: {
    text: 'text-info',
    chip: 'border-info/30 bg-info/[0.08] text-info',
    border: 'border-info/30',
    glow: withAlpha(PALETTE.info, 0.14),
    stroke: PALETTE.info,
    soft: 'bg-info/10',
  },
}
