import type { Candle } from '../../types/market'
import { atr, bollinger, closesOf, ema, rsi, type BollingerSeries, type Series } from '../indicators'

export interface CandleIndicators {
  atr: Series
  atrSma: Series
  rsi: Series
  bands: BollingerSeries
}

/** Multiplicador padrão das Bandas de Bollinger do Playbook D (tuning v2). */
export const BB_MULTIPLIER = 1.8
export const BB_PERIOD = 20
export const EMA200_PERIOD = 200
const HOUR_SECONDS = 3600

const cache = new WeakMap<readonly Candle[], CandleIndicators>()
const bandsCache = new WeakMap<readonly Candle[], Map<number, BollingerSeries>>()

export interface H1Ema200 {
  /** Candles H1 reamostrados (time = início da hora UTC). */
  candles: Candle[]
  /** EMA(200) sobre os fechamentos H1, alinhada a `candles`. */
  ema: Series
}

const h1Cache = new WeakMap<readonly Candle[], H1Ema200>()

/** Média dos últimos `period` valores não-nulos da série até `index` (causal). */
export function trailingSma(series: Series, index: number, period: number): number | null {
  const values: number[] = []
  for (let cursor = index; cursor >= 0 && values.length < period; cursor -= 1) {
    const value = series[cursor]
    if (value !== null) values.push(value)
  }
  if (values.length < period) return null
  let sum = 0
  for (const value of values) sum += value
  return sum / period
}

function buildSmaSeries(series: Series, period: number): Series {
  const output: Series = new Array(series.length).fill(null)
  for (let index = 0; index < series.length; index += 1) {
    output[index] = trailingSma(series, index, period)
  }
  return output
}

/** Bollinger(20, multiplier) com cache por série × multiplicador. */
export function bandsFor(candles: readonly Candle[], multiplier: number): BollingerSeries {
  let byMultiplier = bandsCache.get(candles)
  if (byMultiplier === undefined) {
    byMultiplier = new Map()
    bandsCache.set(candles, byMultiplier)
  }
  const cached = byMultiplier.get(multiplier)
  if (cached !== undefined) return cached
  const bands = bollinger(closesOf(candles), BB_PERIOD, multiplier)
  byMultiplier.set(multiplier, bands)
  return bands
}

/**
 * Reamostra candles M5 em candles H1 agrupados por hora UTC:
 * open do primeiro, close do último, high máximo, low mínimo,
 * volume somado. `time` = início da hora.
 */
export function resampleToH1(candlesM5: readonly Candle[]): Candle[] {
  const h1: Candle[] = []
  let bucket = Number.NaN
  for (const candle of candlesM5) {
    const hour = Math.floor(candle.time / HOUR_SECONDS)
    if (hour !== bucket) {
      bucket = hour
      h1.push({
        time: hour * HOUR_SECONDS,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })
    } else {
      const current = h1[h1.length - 1]
      current.high = Math.max(current.high, candle.high)
      current.low = Math.min(current.low, candle.low)
      current.close = candle.close
      current.volume += candle.volume
    }
  }
  return h1
}

/** Série H1 + EMA(200) dos fechamentos H1, com cache por array M5. */
export function h1Ema200Series(candlesM5: readonly Candle[]): H1Ema200 {
  const cached = h1Cache.get(candlesM5)
  if (cached !== undefined) return cached
  const candles = resampleToH1(candlesM5)
  const computed: H1Ema200 = { candles, ema: ema(closesOf(candles), EMA200_PERIOD) }
  h1Cache.set(candlesM5, computed)
  return computed
}

/**
 * EMA200 do último candle H1 FECHADO antes do candle M5 em `index`.
 * Um candle H1 da hora H fecha em H+1:00; ele só é elegível para candles
 * M5 com time >= H+1:00 — nunca usa dados da hora ainda em formação
 * (sem look-ahead).
 */
export function h1Ema200At(candlesM5: readonly Candle[], index: number): number | null {
  const m5 = candlesM5[index]
  if (m5 === undefined) return null
  const { candles: h1, ema: series } = h1Ema200Series(candlesM5)
  // Último H1 com h1.time + 3600 <= m5.time (hora fechada na abertura do M5).
  let lo = 0
  let hi = h1.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (h1[mid].time + HOUR_SECONDS <= m5.time) lo = mid + 1
    else hi = mid
  }
  const last = lo - 1
  if (last < 0) return null
  return series[last]
}

/**
 * Indicadores compartilhados dos playbooks no timeframe M5:
 * ATR(14), SMA(ATR,50), RSI(14) e Bollinger(20, 1.8). Calculados uma
 * vez por série de candles (cache por identidade do array).
 */
export function indicatorsFor(candles: readonly Candle[]): CandleIndicators {
  const cached = cache.get(candles)
  if (cached !== undefined) return cached

  const atrSeries = atr(candles, 14)
  const computed: CandleIndicators = {
    atr: atrSeries,
    atrSma: buildSmaSeries(atrSeries, 50),
    rsi: rsi(closesOf(candles), 14),
    bands: bandsFor(candles, BB_MULTIPLIER),
  }
  cache.set(candles, computed)
  return computed
}
