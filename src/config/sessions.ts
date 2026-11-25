import type { SessionWindow } from '../types/lab'

/**
 * Janelas de sessão padrão do laboratório, sempre em UTC.
 * `startUtc` é inclusivo e `endUtc` é exclusivo.
 */
export const DEFAULT_SESSIONS: SessionWindow[] = [
  { name: 'london', startUtc: '07:00', endUtc: '11:00' },
  { name: 'ny', startUtc: '13:00', endUtc: '17:00' },
]
