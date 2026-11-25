import type { Candle, CandleDirection, SetupCondition } from '../../../types/market'
import type { Series } from '../../indicators'
import type { PreparedConfirmation } from '../../strategy'

export interface LegacyEvaluation {
  direction: CandleDirection | null
  conditions: SetupCondition[]
}

export function confirmationSlope(
  confirmation: PreparedConfirmation,
  triggerCloseTime: number,
  confirmationSeconds: number,
): number | null {
  const candles = confirmation.candles
  let low = 0
  let high = candles.length - 1
  let best = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (candles[middle].time + confirmationSeconds <= triggerCloseTime) {
      best = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (best < 54) return null
  const current = confirmation.ema50[best]
  const previous = confirmation.ema50[best - 5]
  if (current === null || previous === null) return null
  return current - previous
}

export function rsiWindow(series: Series, index: number, size: number): number[] {
  const values: number[] = []
  for (let cursor = index; cursor >= 0 && cursor > index - size; cursor -= 1) {
    const value = series[cursor]
    if (value !== null) values.push(value)
  }
  return values
}

export function wickRatio(candle: Candle, direction: CandleDirection): number {
  const range = candle.high - candle.low
  if (range <= 0) return 0
  return direction === 'UP'
    ? (Math.min(candle.open, candle.close) - candle.low) / range
    : (candle.high - Math.max(candle.open, candle.close)) / range
}
