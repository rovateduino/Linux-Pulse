import type { Candle } from '../types/market'

export type Series = (number | null)[]

export function ema(values: readonly number[], period: number): Series {
  const output: Series = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return output

  let sum = 0
  for (let index = 0; index < period; index += 1) sum += values[index]
  let previous = sum / period
  output[period - 1] = previous

  const multiplier = 2 / (period + 1)
  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] - previous) * multiplier + previous
    output[index] = previous
  }
  return output
}

export function rsi(values: readonly number[], period = 14): Series {
  const output: Series = new Array(values.length).fill(null)
  if (period <= 0 || values.length <= period) return output

  let gains = 0
  let losses = 0
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1]
    if (change >= 0) gains += change
    else losses -= change
  }

  let averageGain = gains / period
  let averageLoss = losses / period
  output[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1]
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    averageGain = (averageGain * (period - 1) + gain) / period
    averageLoss = (averageLoss * (period - 1) + loss) / period
    output[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
  }
  return output
}

export function trueRange(candles: readonly Candle[]): Series {
  const output: Series = new Array(candles.length).fill(null)
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index]
    if (index === 0) {
      output[index] = candle.high - candle.low
      continue
    }
    const previousClose = candles[index - 1].close
    output[index] = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    )
  }
  return output
}

function wilderSmooth(values: readonly number[], period: number): Series {
  const output: Series = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return output

  let sum = 0
  for (let index = 0; index < period; index += 1) sum += values[index]
  let previous = sum / period
  output[period - 1] = previous

  for (let index = period; index < values.length; index += 1) {
    previous = (previous * (period - 1) + values[index]) / period
    output[index] = previous
  }
  return output
}

export function atr(candles: readonly Candle[], period = 14): Series {
  const ranges = trueRange(candles).slice(1)
  const usable = ranges.filter((value): value is number => value !== null)
  const smoothed = wilderSmooth(usable, period)
  const output: Series = new Array(candles.length).fill(null)
  for (let index = 0; index < smoothed.length; index += 1) {
    output[index + 1] = smoothed[index]
  }
  return output
}

export interface AdxSeries {
  adx: Series
  plusDi: Series
  minusDi: Series
}

export function adx(candles: readonly Candle[], period = 14): AdxSeries {
  const length = candles.length
  const plusDm: number[] = []
  const minusDm: number[] = []
  const ranges: number[] = []

  for (let index = 1; index < length; index += 1) {
    const candle = candles[index]
    const previous = candles[index - 1]
    const upMove = candle.high - previous.high
    const downMove = previous.low - candle.low
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0)
    ranges.push(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previous.close),
        Math.abs(candle.low - previous.close),
      ),
    )
  }

  const smoothedPlus = wilderSmooth(plusDm, period)
  const smoothedMinus = wilderSmooth(minusDm, period)
  const smoothedRange = wilderSmooth(ranges, period)
  const plusDi: Series = new Array(length).fill(null)
  const minusDi: Series = new Array(length).fill(null)
  const adxOutput: Series = new Array(length).fill(null)

  const candleIndices: number[] = []
  const dxValues: number[] = []

  for (let index = 0; index < smoothedRange.length; index += 1) {
    const range = smoothedRange[index]
    const plus = smoothedPlus[index]
    const minus = smoothedMinus[index]
    if (range === null || plus === null || minus === null || range === 0) continue

    const candleIndex = index + 1
    const plusValue = (100 * plus) / range
    const minusValue = (100 * minus) / range
    plusDi[candleIndex] = plusValue
    minusDi[candleIndex] = minusValue
    const denominator = plusValue + minusValue
    candleIndices.push(candleIndex)
    dxValues.push(denominator === 0 ? 0 : (100 * Math.abs(plusValue - minusValue)) / denominator)
  }

  const smoothedDx = wilderSmooth(dxValues, period)
  for (let index = 0; index < smoothedDx.length; index += 1) {
    const value = smoothedDx[index]
    if (value === null) continue
    adxOutput[candleIndices[index]] = value
  }

  return { adx: adxOutput, plusDi, minusDi }
}

export interface BollingerSeries {
  middle: Series
  upper: Series
  lower: Series
  bandwidth: Series
}

export function bollinger(values: readonly number[], period = 20, multiplier = 2): BollingerSeries {
  const middle: Series = new Array(values.length).fill(null)
  const upper: Series = new Array(values.length).fill(null)
  const lower: Series = new Array(values.length).fill(null)
  const bandwidth: Series = new Array(values.length).fill(null)

  for (let index = period - 1; index < values.length; index += 1) {
    let sum = 0
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) sum += values[cursor]
    const mean = sum / period

    let variance = 0
    for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
      const difference = values[cursor] - mean
      variance += difference * difference
    }
    const deviation = Math.sqrt(variance / period)

    middle[index] = mean
    upper[index] = mean + multiplier * deviation
    lower[index] = mean - multiplier * deviation
    bandwidth[index] = mean === 0 ? null : (upper[index]! - lower[index]!) / mean
  }

  return { middle, upper, lower, bandwidth }
}

export function percentileRank(window: readonly number[], value: number): number | null {
  if (window.length === 0) return null
  let below = 0
  for (const sample of window) {
    if (sample <= value) below += 1
  }
  return (below / window.length) * 100
}

export function latest(series: Series): number | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index]
    if (value !== null) return value
  }
  return null
}

export function valueAt(series: Series, index: number): number | null {
  if (index < 0 || index >= series.length) return null
  return series[index]
}

export function normalizedSlope(
  series: Series,
  atrValues: Series,
  lookback = 5,
  index = series.length - 1,
): number | null {
  if (index - lookback < 0) return null
  const current = series[index]
  const previous = series[index - lookback]
  const volatility = atrValues[index]
  if (current === null || previous === null || volatility === null || volatility === 0) return null
  return (current - previous) / volatility
}

export function bandwidthPercentile(bandwidth: Series, window = 100, index = bandwidth.length - 1): number | null {
  const current = bandwidth[index]
  if (current === null) return null
  const samples: number[] = []
  for (let cursor = index; cursor >= 0 && samples.length < window; cursor -= 1) {
    const value = bandwidth[cursor]
    if (value !== null) samples.push(value)
  }
  return percentileRank(samples, current)
}

export function closesOf(candles: readonly Candle[]): number[] {
  return candles.map((candle) => candle.close)
}
