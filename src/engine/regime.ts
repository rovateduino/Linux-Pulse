import type { Candle, RegimeInfo } from '../types/market'
import {
  adx,
  atr,
  bandwidthPercentile,
  bollinger,
  ema,
  normalizedSlope,
  valueAt,
} from './indicators'

export interface RegimeMetrics {
  adx: number
  slope: number
  bandwidthPct: number
  emaAligned: boolean
  alignedUp: boolean
}

export function classifyMetrics(metrics: RegimeMetrics): 'TENDENCIA' | 'LATERAL' | 'SEM_REGIME' {
  const { adx: adxValue, slope, bandwidthPct, emaAligned } = metrics
  const isTrend = adxValue >= 25 && Math.abs(slope) >= 0.3 && emaAligned
  if (isTrend) return 'TENDENCIA'
  const isLateral = adxValue < 18 && bandwidthPct <= 40 && Math.abs(slope) < 0.15
  if (isLateral) return 'LATERAL'
  return 'SEM_REGIME'
}

export function classifyRegime(candles: readonly Candle[], index = candles.length - 1): RegimeInfo {
  const empty: RegimeInfo = {
    kind: 'SEM_REGIME',
    direction: null,
    adx: null,
    slope: null,
    bandwidthPct: null,
    emaAligned: false,
    ema20: null,
    ema50: null,
    ema200: null,
  }
  if (index < 0 || index >= candles.length || candles.length < 200) return empty

  const prefix = candles.slice(0, index + 1)
  const closes = prefix.map((candle) => candle.close)
  const ema20 = ema(closes, 20)
  const ema50 = ema(closes, 50)
  const ema200 = ema(closes, 200)
  const atrSeries = atr(prefix, 14)
  const adxSeries = adx(prefix, 14).adx
  const bands = bollinger(closes, 20, 2)
  const last = prefix.length - 1

  const ema20Value = valueAt(ema20, last)
  const ema50Value = valueAt(ema50, last)
  const ema200Value = valueAt(ema200, last)
  const adxValue = valueAt(adxSeries, last)
  const slope = normalizedSlope(ema50, atrSeries, 5, last)
  const bandwidthPct = bandwidthPercentile(bands.bandwidth, 100, last)

  if (
    ema20Value === null ||
    ema50Value === null ||
    ema200Value === null ||
    adxValue === null ||
    slope === null ||
    bandwidthPct === null
  ) {
    return empty
  }

  const alignedUp = ema20Value > ema50Value && ema50Value > ema200Value
  const alignedDown = ema20Value < ema50Value && ema50Value < ema200Value
  const aligned = alignedUp || alignedDown
  const kind = classifyMetrics({
    adx: adxValue,
    slope,
    bandwidthPct,
    emaAligned: aligned,
    alignedUp,
  })

  return {
    kind,
    direction: kind === 'TENDENCIA' ? (alignedUp ? 'UP' : 'DOWN') : null,
    adx: adxValue,
    slope,
    bandwidthPct,
    emaAligned: aligned,
    ema20: ema20Value,
    ema50: ema50Value,
    ema200: ema200Value,
  }
}
