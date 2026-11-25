import type { AssetDef, Candle, Timeframe } from '../types/market'
import { ASSETS, TIMEFRAME_SECONDS } from './assets'

export const TICK_MS = 200
export const SIM_SPEED = 30
export const PREFILL_M1 = 4320
export const RETENTION_M1 = 4800

const SECONDS_PER_MINUTE = 60
const TWO_PI = Math.PI * 2

export interface SimFeed {
  anchorSec: number
  startedAtMs: number
  lastClosedMinute: number
  series: Record<string, Candle[]>
}

function hashUnit(seed: number, minute: number, channel: number): number {
  let h = seed | 0
  h ^= Math.imul(minute | 0, 0x9e3779b1)
  h ^= Math.imul(channel | 0, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function levelAt(asset: AssetDef, minute: number): number {
  const macro = Math.sin((TWO_PI * minute) / (1440 + asset.phase * 37) + asset.phase)
  const swing = Math.sin((TWO_PI * minute) / asset.trendPeriod + asset.phase * 2.1)
  const micro = Math.sin((TWO_PI * minute) / 113 + asset.phase * 0.7)
  const envelope = 0.6 + 0.4 * Math.abs(Math.sin((TWO_PI * minute) / 327 + asset.phase))
  const noise = (hashUnit(asset.seed, Math.floor(minute), 1) - 0.5) * 2 * asset.volatility
  const volatilityScale = asset.volatility / 0.0011
  return asset.basePrice * Math.exp(
    0.055 * volatilityScale * macro +
      0.028 * volatilityScale * swing +
      0.009 * volatilityScale * micro +
      noise * envelope,
  )
}

function roundPrice(asset: AssetDef, price: number): number {
  return Number(price.toFixed(asset.decimals))
}

export function generateM1(asset: AssetDef, startMinute: number, count: number): Candle[] {
  const candles: Candle[] = []
  for (let index = 0; index < count; index += 1) {
    const minute = startMinute + index
    const open = roundPrice(asset, levelAt(asset, minute))
    const close = roundPrice(asset, levelAt(asset, minute + 1))
    const body = Math.abs(close - open)
    const wick = (0.22 + hashUnit(asset.seed, minute, 2) * 0.7) * asset.volatility
    const high = roundPrice(
      asset,
      Math.max(open, close) * (1 + wick + body / Math.max(open, close) * 0.12),
    )
    const low = roundPrice(
      asset,
      Math.min(open, close) * (1 - wick - body / Math.max(open, close) * 0.12),
    )
    const volume = asset.volumeBase * (0.45 + hashUnit(asset.seed, minute, 3) * 1.3)

    candles.push({
      time: minute * SECONDS_PER_MINUTE,
      open,
      high,
      low,
      close,
      volume,
    })
  }
  return candles
}

export function partialM1(asset: AssetDef, minute: number, progress: number): Candle {
  const clamped = Math.min(1, Math.max(0, progress))
  const open = roundPrice(asset, levelAt(asset, minute))
  const fullClose = roundPrice(asset, levelAt(asset, minute + 1))
  const eased = 1 - (1 - clamped) * (1 - clamped)
  const close = roundPrice(asset, open + (fullClose - open) * eased)
  const wick = (0.12 + hashUnit(asset.seed, minute, 4) * 0.4) * asset.volatility * clamped
  const high = roundPrice(asset, Math.max(open, close) * (1 + wick))
  const low = roundPrice(asset, Math.min(open, close) * (1 - wick))
  const volume = asset.volumeBase * (0.08 + hashUnit(asset.seed, minute, 5) * 1.2) * clamped

  return {
    time: minute * SECONDS_PER_MINUTE,
    open,
    high,
    low,
    close,
    volume,
  }
}

export function generateSimulatedM5(
  asset: AssetDef,
  startSec: number,
  count: number,
): Candle[] {
  const startMinute = Math.floor(startSec / SECONDS_PER_MINUTE)
  const m1 = generateM1(asset, startMinute, count * 5)
  return aggregateCandles(m1, 300)
}

/**
 * Série M1 do laboratório: 60 segundos por vela (SECONDS_PER_MINUTE),
 * alinhada ao minuto fechado — mesma base usada pelo feed do terminal.
 */
export function generateSimulatedM1(
  asset: AssetDef,
  startSec: number,
  count: number,
): Candle[] {
  const startMinute = Math.floor(startSec / SECONDS_PER_MINUTE)
  return generateM1(asset, startMinute, count)
}

export function aggregateCandles(candles: readonly Candle[], timeframeSec: number): Candle[] {
  if (candles.length === 0) return []
  const lastEnd = candles[candles.length - 1].time + SECONDS_PER_MINUTE
  const aggregated: Candle[] = []

  for (const candle of candles) {
    const bucket = Math.floor(candle.time / timeframeSec) * timeframeSec
    if (bucket + timeframeSec > lastEnd) continue

    const current = aggregated[aggregated.length - 1]
    if (current === undefined || current.time !== bucket) {
      aggregated.push({
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })
      continue
    }

    current.high = Math.max(current.high, candle.high)
    current.low = Math.min(current.low, candle.low)
    current.close = candle.close
    current.volume += candle.volume
  }

  return aggregated
}

export function currentFormingCandle(
  asset: AssetDef,
  candles: readonly Candle[],
  timeframe: Timeframe,
  simNowSec: number,
): Candle | null {
  const timeframeSec = TIMEFRAME_SECONDS[timeframe]
  const bucketStart = Math.floor(simNowSec / timeframeSec) * timeframeSec
  const minuteStart = Math.floor(simNowSec / SECONDS_PER_MINUTE) * SECONDS_PER_MINUTE
  const minute = minuteStart / SECONDS_PER_MINUTE
  const progress = (simNowSec - minuteStart) / SECONDS_PER_MINUTE
  const partial = partialM1(asset, minute, progress)

  const parts: Candle[] = candles.filter((candle) => candle.time >= bucketStart)
  parts.push(partial)

  const open = parts[0].open
  const close = parts[parts.length - 1].close
  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  let volume = 0
  for (const part of parts) {
    high = Math.max(high, part.high)
    low = Math.min(low, part.low)
    volume += part.volume
  }

  return {
    time: bucketStart,
    open,
    high,
    low,
    close,
    volume,
  }
}

export function timeframeProgress(
  simNowSec: number,
  timeframe: Timeframe,
): { progress: number; secondsLeft: number } {
  const timeframeSec = TIMEFRAME_SECONDS[timeframe]
  const elapsed = simNowSec % timeframeSec
  const progress = elapsed / timeframeSec
  return {
    progress,
    secondsLeft: Math.max(1, Math.ceil(timeframeSec - elapsed)),
  }
}

export function simNowSeconds(feed: SimFeed, realNowMs: number): number {
  const elapsed = Math.max(0, realNowMs - feed.startedAtMs)
  return feed.anchorSec + (elapsed / 1000) * SIM_SPEED
}

export function createSimFeed(realNowMs: number, assets: readonly AssetDef[] = ASSETS): SimFeed {
  const anchorSec = Math.floor(realNowMs / (SECONDS_PER_MINUTE * 1000)) * SECONDS_PER_MINUTE
  const anchorMinute = anchorSec / SECONDS_PER_MINUTE
  const startMinute = anchorMinute - PREFILL_M1
  const series: Record<string, Candle[]> = {}

  for (const asset of assets) {
    series[asset.symbol] = generateM1(asset, startMinute, PREFILL_M1)
  }

  return {
    anchorSec,
    startedAtMs: realNowMs,
    lastClosedMinute: anchorMinute - 1,
    series,
  }
}

export function advanceSimFeed(
  feed: SimFeed,
  simNow: number,
  assets: readonly AssetDef[] = ASSETS,
): SimFeed {
  const targetMinute = Math.floor(simNow / SECONDS_PER_MINUTE) - 1
  if (targetMinute <= feed.lastClosedMinute) return feed

  const series: Record<string, Candle[]> = {}
  for (const asset of assets) {
    const existing = feed.series[asset.symbol] ?? []
    const additions: Candle[] = []
    for (let minute = feed.lastClosedMinute + 1; minute <= targetMinute; minute += 1) {
      additions.push(...generateM1(asset, minute, 1))
    }
    const merged = existing.concat(additions)
    series[asset.symbol] = merged.length > RETENTION_M1 ? merged.slice(-RETENTION_M1) : merged
  }

  return {
    ...feed,
    lastClosedMinute: targetMinute,
    series,
  }
}

export function chartCandles(
  asset: AssetDef,
  feed: SimFeed,
  timeframe: Timeframe,
  simNow: number,
): { closed: Candle[]; forming: Candle | null } {
  const timeframeSec = TIMEFRAME_SECONDS[timeframe]
  const m1 = feed.series[asset.symbol] ?? []
  return {
    closed: aggregateCandles(m1, timeframeSec),
    forming: currentFormingCandle(asset, m1, timeframe, simNow),
  }
}
