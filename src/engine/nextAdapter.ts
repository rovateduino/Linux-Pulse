import { validateSeries } from './next'
import type { Candle as EngineCandle } from './next'
import { localDayId } from './next/context'
import type { Candle } from '../types/market'

export function toEngineCandles(
  candles: readonly Candle[],
  timeframeMinutes: number,
  utcOffsetMinutes: number,
): EngineCandle[] {
  const timeframeSeconds = timeframeMinutes * 60
  const converted = candles.map((candle) => ({
    ...candle,
    time: (candle.time + timeframeSeconds) * 1000,
  }))
  const problems = validateSeries(converted, timeframeMinutes, utcOffsetMinutes)
  if (problems.length > 0) {
    throw new Error(`Série de candles inválida: ${problems.join(' | ')}`)
  }
  return converted
}

export function inferTimeframeMinutes(
  candles: readonly Candle[],
  utcOffsetMinutes: number,
): number {
  const counts = new Map<number, number>()
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1]
    const current = candles[index]
    if (previous === undefined || current === undefined) continue
    if (localDayId(previous.time * 1000, utcOffsetMinutes) !== localDayId(current.time * 1000, utcOffsetMinutes)) {
      continue
    }
    const deltaSeconds = current.time - previous.time
    if (deltaSeconds <= 0 || deltaSeconds > 900) continue
    const minutes = Math.round(deltaSeconds / 60)
    if (![1, 5, 15].includes(minutes) || Math.abs(deltaSeconds - minutes * 60) > 1) continue
    counts.set(minutes, (counts.get(minutes) ?? 0) + 1)
  }

  const inferred = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
  if (inferred === undefined) {
    throw new Error('Não foi possível derivar um timeframe M1, M5 ou M15 da série.')
  }
  return inferred
}
