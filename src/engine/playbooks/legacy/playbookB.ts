import type { CandleDirection } from '../../../types/market'
import type { PreparedMarket } from '../../strategy'
import { rsiWindow, wickRatio, type LegacyEvaluation } from './helpers'

/**
 * Playbook B (legado) — reversão em lateral.
 * Extraído de `evaluateSetup` (strategy.ts); comportamento preservado.
 */
export function evaluateB(
  prepared: PreparedMarket,
  index: number,
  emaDirection: CandleDirection | null,
  blockedBy: readonly string[],
): LegacyEvaluation {
  const candles = prepared.candles
  const current = candles[index]
  const previous = candles[index - 1]
  const lowerNow = prepared.bands.lower[index]
  const upperNow = prepared.bands.upper[index]
  const lowerBefore = prepared.bands.lower[index - 1]
  const upperBefore = prepared.bands.upper[index - 1]
  const middle = prepared.bands.middle[index]

  const breachUp =
    (lowerNow !== null && current.close < lowerNow) ||
    (lowerBefore !== null && previous.close < lowerBefore)
  const breachDown =
    (upperNow !== null && current.close > upperNow) ||
    (upperBefore !== null && previous.close > upperBefore)

  const direction: CandleDirection | null =
    breachUp && !breachDown
      ? 'UP'
      : breachDown && !breachUp
        ? 'DOWN'
        : middle !== null
          ? current.close < middle
            ? 'UP'
            : 'DOWN'
          : emaDirection

  const inside =
    lowerNow !== null &&
    upperNow !== null &&
    current.close >= lowerNow &&
    current.close <= upperNow
  const setupDirection: CandleDirection = direction ?? 'UP'
  const rsiValues = rsiWindow(prepared.rsi, index, 2)
  const extremeRsi =
    setupDirection === 'UP'
      ? rsiValues.length > 0 && Math.min(...rsiValues) <= 30
      : rsiValues.length > 0 && Math.max(...rsiValues) >= 70
  const rejection =
    Math.max(wickRatio(current, setupDirection), wickRatio(previous, setupDirection)) >= 0.4

  const conditions = [
    { label: 'Regime lateral', met: true },
    { label: 'Banda rompida', met: breachUp || breachDown },
    { label: 'Retorno para a banda', met: inside },
    { label: 'RSI extremo', met: extremeRsi },
    { label: 'Pavio de rejeição', met: rejection },
    { label: 'Filtros de risco', met: blockedBy.length === 0 },
  ]

  return { direction, conditions }
}
