import type { LabSource } from '../types/lab'

export const ORIGIN_SHORT: Record<LabSource, string> = {
  bot: 'CSV do bot',
  binance: 'Binance pública',
  simulado: 'Simulado local',
}

export const ORIGIN_RESULT: Record<LabSource, string> = {
  bot: 'BOT (IQ Option)',
  binance: 'Binance',
  simulado: 'SIMULADO',
}

export const ORIGIN_BADGE: Record<LabSource, string> = {
  bot: 'ORIGEM: BOT (IQ OPTION)',
  binance: 'ORIGEM: BINANCE (PÚBLICO)',
  simulado: 'SIMULADO',
}

export const ORIGIN_BADGE_CLASS: Record<LabSource, string> = {
  bot: 'border-accent/30 bg-accent/[0.08] text-accentText',
  binance: 'border-info/30 bg-info/[0.08] text-info',
  simulado: 'border-warn/30 bg-warn/[0.08] text-warn',
}

export const ORIGIN_CHIP_CLASS: Record<LabSource, string> = {
  bot: 'border-accent/30 bg-accent/[0.07] text-accentText',
  binance: 'border-info/30 bg-info/[0.07] text-info',
  simulado: 'border-warn/30 bg-warn/[0.07] text-warn',
}
