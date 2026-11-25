import type { Candle } from '../../types/market'
import type { SessionWindow } from '../../types/lab'
import { DEFAULT_SESSIONS } from '../../config/sessions'

const SECONDS_PER_DAY = 24 * 60 * 60
const HH_MM = /^(\d{1,2}):(\d{2})$/

/** Converte "HH:MM" em segundos desde a meia-noite UTC. `null` quando inválido. */
function parseClock(value: string): number | null {
  const match = HH_MM.exec(value.trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 3600 + minutes * 60
}

function secondOfDayUtc(timestampSeconds: number): number {
  const floored = Math.floor(timestampSeconds)
  return ((floored % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY
}

/**
 * `true` quando o timestamp (segundos unix UTC) cai em alguma das janelas.
 * Inclusivo no início (`startUtc`), exclusivo no fim (`endUtc`). Janelas que
 * cruzam a meia-noite (ex.: 22:00 → 02:00) também são suportadas.
 */
export function isInSession(
  ts: number,
  sessions: SessionWindow[] = DEFAULT_SESSIONS,
): boolean {
  if (!Number.isFinite(ts)) return false
  const second = secondOfDayUtc(ts)
  for (const session of sessions) {
    const start = parseClock(session.startUtc)
    const end = parseClock(session.endUtc)
    if (start === null || end === null || start === end) continue
    if (start < end) {
      if (second >= start && second < end) return true
    } else if (second >= start || second < end) {
      return true
    }
  }
  return false
}

/** Mantém apenas as velas cujo `time` (segundos unix UTC) cai em alguma janela. */
export function filterCandlesBySession(
  candles: readonly Candle[],
  sessions: SessionWindow[] = DEFAULT_SESSIONS,
): Candle[] {
  return candles.filter((candle) => isInSession(candle.time, sessions))
}
