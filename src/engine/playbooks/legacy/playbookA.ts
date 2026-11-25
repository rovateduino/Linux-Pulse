import type { CandleDirection } from '../../../types/market'
import type {
  PreparedConfirmation,
  PreparedMarket,
  SetupTiming,
} from '../../strategy'
import { confirmationSlope, rsiWindow, type LegacyEvaluation } from './helpers'

/**
 * Playbook A (legado) — pullback em tendência.
 * Extraído de `evaluateSetup` (strategy.ts); comportamento preservado.
 */
export function evaluateA(
  prepared: PreparedMarket,
  confirmation: PreparedConfirmation,
  index: number,
  timing: SetupTiming,
  regimeDirection: CandleDirection | null,
  emaDirection: CandleDirection | null,
  regimeIsTrend: boolean,
  blockedBy: readonly string[],
): LegacyEvaluation {
  const candles = prepared.candles
  const current = candles[index]
  const atrValue = prepared.atr[index]
  const ema20 = prepared.ema20[index]
  const ema50 = prepared.ema50[index]
  const ema200 = prepared.ema200[index]

  const direction: CandleDirection | null = regimeDirection ?? emaDirection
  const aligned =
    ema20 !== null &&
    ema50 !== null &&
    ema200 !== null &&
    (direction === 'UP'
      ? ema20 > ema50 && ema50 > ema200
      : ema20 < ema50 && ema50 < ema200)

  const recent = candles.slice(Math.max(0, index - 2), index + 1)
  const minLow = Math.min(...recent.map((candle) => candle.low))
  const maxHigh = Math.max(...recent.map((candle) => candle.high))
  const pullback =
    ema20 !== null &&
    atrValue !== null &&
    (direction === 'UP'
      ? minLow <= ema20 + 0.25 * atrValue
      : maxHigh >= ema20 - 0.25 * atrValue)

  const rsiValues = rsiWindow(prepared.rsi, index, 5)
  const lowRsi = rsiValues.length >= 3 ? Math.min(...rsiValues) : null
  const highRsi = rsiValues.length >= 3 ? Math.max(...rsiValues) : null
  const pullbackRsi =
    direction === 'UP'
      ? lowRsi !== null && lowRsi >= 35 && lowRsi <= 50
      : highRsi !== null && highRsi >= 50 && highRsi <= 65

  const range = current.high - current.low
  const body = Math.abs(current.close - current.open)
  const bodyRatio = range > 0 ? body / range : 0
  const trigger =
    direction === 'UP'
      ? current.close > current.open &&
        current.close > candles[index - 1].high &&
        bodyRatio >= 0.5 &&
        current.close >= current.high - range / 3
      : current.close < current.open &&
        current.close < candles[index - 1].low &&
        bodyRatio >= 0.5 &&
        current.close <= current.low + range / 3

  const slope = confirmationSlope(
    confirmation,
    current.time + timing.candleSeconds,
    timing.confirmationSeconds,
  )
  const confirmed = slope !== null && (direction === 'UP' ? slope > 0 : slope < 0)

  const conditions = [
    { label: 'Regime de tendência', met: regimeIsTrend },
    { label: 'EMAs 20/50/200 alinhadas', met: aligned },
    { label: 'Pullback à EMA20', met: pullback },
    { label: 'RSI de pullback', met: pullbackRsi },
    { label: 'Gatilho de rompimento', met: trigger },
    { label: `Confirmação M${timing.confirmationSeconds / 60}`, met: confirmed },
    { label: 'Filtros de risco', met: blockedBy.length === 0 },
  ]

  return { direction, conditions }
}
