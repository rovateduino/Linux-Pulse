import { adx, atr, ema, percentileRank, rsi, vwap } from './indicators.js'
import type {
  Candle,
  EngineConfig,
  MarketContext,
  OpeningRange,
  Regime,
  SessionConfig,
  SessionPhase,
} from './types.js'

const DAY_MS = 86_400_000

export interface PreparedSeries {
  ema20: number[]
  ema50: number[]
  ema200: number[]
  atr14: number[]
  adx14: number[]
  rsi14: number[]
}

/** Valida que os candles estao fechados, ordenados e no timeframe configurado. */
export function validateSeries(candles: Candle[], timeframeMinutes: number, utcOffsetMinutes = 0): string[] {
  const problems: string[] = []
  if (candles.length < 50) problems.push(`serie curta: ${candles.length} candles (minimo 50)`)
  const step = timeframeMinutes * 60_000
  let mismatches = 0
  for (let i = 1; i < candles.length; i++) {
    const d = candles[i].time - candles[i - 1].time
    // quebra entre sessoes nao e erro de timeframe
    if (localDayId(candles[i].time, utcOffsetMinutes) !== localDayId(candles[i - 1].time, utcOffsetMinutes)) continue
    if (Math.abs(d - step) > 1_000) mismatches++
  }
  if (mismatches > 0) {
    problems.push(
      `${mismatches} intervalos fora de ${timeframeMinutes}m: os dados nao estao no timeframe configurado (repare o M1/M5 antes de operar)`,
    )
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!(c.high >= c.low) || !(c.high >= c.open) || !(c.high >= c.close) || !(c.low <= c.open) || !(c.low <= c.close)) {
      problems.push(`candle ${i} inconsistente (OHLC invalido)`)
      break
    }
  }
  return problems
}

export function localMinuteOfDay(time: number, utcOffsetMinutes: number): number {
  const local = time + utcOffsetMinutes * 60_000
  const mod = ((local % DAY_MS) + DAY_MS) % DAY_MS
  return mod / 60_000
}

export function localDayId(time: number, utcOffsetMinutes: number): string {
  const local = time + utcOffsetMinutes * 60_000
  const day = Math.floor(local / DAY_MS)
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function phaseOf(minutesFromOpen: number, cfg: SessionConfig): SessionPhase {
  const sessionLength = cfg.closeMinute - cfg.openMinute
  if (minutesFromOpen < 0) return 'pre'
  if (minutesFromOpen > sessionLength) return 'post'
  if (minutesFromOpen < cfg.openingRangeMinutes) return 'opening'
  if (minutesFromOpen < 180) return 'morning'
  if (minutesFromOpen < sessionLength - 120) return 'midday'
  if (minutesFromOpen < sessionLength - cfg.noEntryBeforeCloseMinutes) return 'power'
  return 'close'
}

/**
 * Pre-calcula tudo o que nao depende do candle corrente e expoe
 * `contextAt(i)`, sempre usando apenas candles com indice <= i.
 */
export class ContextBuilder {
  readonly candles: Candle[]
  readonly cfg: EngineConfig
  readonly series: PreparedSeries
  private readonly sessionIds: string[]
  private readonly sessionIndex: number[]
  private readonly sessionFirst: Map<string, number> = new Map()
  private readonly sessionLast: Map<string, number> = new Map()
  private readonly sessionOrder: string[] = []
  /** volume por (indice da sessao, minuto do dia) para RVOL em O(lookback) */
  private readonly volumeBySessionMinute = new Map<string, number>()

  constructor(candles: Candle[], cfg: EngineConfig) {
    this.candles = candles
    this.cfg = cfg
    const closes = candles.map((c) => c.close)
    const adxRes = adx(candles, 14)
    this.series = {
      ema20: ema(closes, 20),
      ema50: ema(closes, 50),
      ema200: ema(closes, 200),
      atr14: atr(candles, 14),
      adx14: adxRes.adx,
      rsi14: rsi(closes, 14),
    }

    const off = cfg.session.utcOffsetMinutes
    this.sessionIds = candles.map((c) => localDayId(c.time, off))
    this.sessionIndex = []
    let current = -1
    for (let i = 0; i < candles.length; i++) {
      const id = this.sessionIds[i]
      if (!this.sessionFirst.has(id)) {
        this.sessionFirst.set(id, i)
        this.sessionOrder.push(id)
        current++
      }
      this.sessionLast.set(id, i)
      this.sessionIndex.push(current)
      const mfo = Math.round(localMinuteOfDay(candles[i].time, off) - cfg.session.openMinute)
      this.volumeBySessionMinute.set(`${current}|${mfo}`, candles[i].volume)
    }
  }

  get length(): number {
    return this.candles.length
  }

  sessionIdAt(i: number): string {
    return this.sessionIds[i]
  }

  private sessionCandlesBefore(id: string, i: number): Candle[] {
    const first = this.sessionFirst.get(id)
    if (first === undefined) return []
    const out: Candle[] = []
    for (let k = first; k <= i && k < this.candles.length; k++) {
      const mfo = this.minutesFromOpen(this.candles[k])
      if (mfo < 0) continue
      out.push(this.candles[k])
    }
    return out
  }

  minutesFromOpen(candle: Candle): number {
    return localMinuteOfDay(candle.time, this.cfg.session.utcOffsetMinutes) - this.cfg.session.openMinute
  }

  private openingRangeAt(i: number): OpeningRange | null {
    const id = this.sessionIds[i]
    const first = this.sessionFirst.get(id)
    if (first === undefined) return null
    const orMinutes = this.cfg.session.openingRangeMinutes
    let high = -Infinity
    let low = Infinity
    let vol = 0
    let bars = 0
    for (let k = first; k <= i; k++) {
      const mfo = this.minutesFromOpen(this.candles[k])
      if (mfo < 0 || mfo >= orMinutes) continue
      const c = this.candles[k]
      high = Math.max(high, c.high)
      low = Math.min(low, c.low)
      vol += c.volume
      bars++
    }
    if (bars === 0) return null

    // RVOL da mesma janela nas sessoes anteriores
    const idx = this.sessionIndex[i]
    const prior: number[] = []
    for (let s = Math.max(0, idx - this.cfg.session.lookbackSessions); s < idx; s++) {
      const sid = this.sessionOrder[s]
      const f = this.sessionFirst.get(sid)
      const l = this.sessionLast.get(sid)
      if (f === undefined || l === undefined) continue
      let v = 0
      let b = 0
      for (let k = f; k <= l; k++) {
        const mfo = this.minutesFromOpen(this.candles[k])
        if (mfo < 0 || mfo >= orMinutes) continue
        v += this.candles[k].volume
        b++
      }
      if (b > 0) prior.push(v)
    }
    const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0
    const atrValue = this.series.atr14[i]
    const complete = this.minutesFromOpen(this.candles[i]) >= orMinutes

    return {
      high,
      low,
      rvol: avg > 0 ? vol / avg : 0,
      rangeAtrRatio: Number.isFinite(atrValue) && atrValue > 0 ? (high - low) / atrValue : 0,
      complete,
    }
  }

  private rvolSameTime(i: number): number {
    const c = this.candles[i]
    const mfo = Math.round(this.minutesFromOpen(c))
    const idx = this.sessionIndex[i]
    const samples: number[] = []
    for (let s = Math.max(0, idx - this.cfg.session.lookbackSessions); s < idx; s++) {
      const v = this.volumeBySessionMinute.get(`${s}|${mfo}`)
      if (v !== undefined) samples.push(v)
    }
    if (!samples.length) return 1
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    return avg > 0 ? c.volume / avg : 1
  }

  private regimeAt(i: number): Regime {
    const { adx14, atr14, ema20, ema50, ema200 } = this.series
    const atrWindow = atr14.slice(Math.max(0, i - 100), i + 1)
    const pct = percentileRank(atrWindow, atr14[i])
    const a = adx14[i]
    const e20 = ema20[i]
    const e50 = ema50[i]
    const e200 = ema200[i]
    const close = this.candles[i].close
    const range = this.candles[i].high - this.candles[i].low
    const atrValue = atr14[i]

    const alignedUp = e20 > e50 && (!Number.isFinite(e200) || close > e200)
    const alignedDown = e20 < e50 && (!Number.isFinite(e200) || close < e200)

    if (Number.isFinite(a) && a >= 25 && (alignedUp || alignedDown)) return alignedUp ? 'trend_up' : 'trend_down'
    if (pct <= 0.3) return 'compression'
    if (Number.isFinite(atrValue) && atrValue > 0 && range > 1.5 * atrValue) return 'expansion'
    return 'range'
  }

  contextAt(i: number): MarketContext {
    const candle = this.candles[i]
    const mfo = this.minutesFromOpen(candle)
    const id = this.sessionIds[i]
    const sIdx = this.sessionIndex[i]
    const sessionCandles = this.sessionCandlesBefore(id, i)
    const vw = vwap(sessionCandles)
    const prevId = sIdx > 0 ? this.sessionOrder[sIdx - 1] : null
    let priorHigh: number | null = null
    let priorLow: number | null = null
    let priorClose: number | null = null
    if (prevId) {
      const f = this.sessionFirst.get(prevId)
      const l = this.sessionLast.get(prevId)
      if (f !== undefined && l !== undefined) {
        let hi = -Infinity
        let lo = Infinity
        for (let k = f; k <= l; k++) {
          const m = this.minutesFromOpen(this.candles[k])
          if (m < 0) continue
          hi = Math.max(hi, this.candles[k].high)
          lo = Math.min(lo, this.candles[k].low)
        }
        priorHigh = Number.isFinite(hi) ? hi : null
        priorLow = Number.isFinite(lo) ? lo : null
        priorClose = this.candles[l].close
      }
    }

    const vwapLookback = Math.max(0, i - 12)
    const prevVwap = vwap(this.sessionCandlesBefore(id, vwapLookback)).vwap
    const atrValue = this.series.atr14[i]
    const slope = Number.isFinite(atrValue) && atrValue > 0 ? (vw.vwap - prevVwap) / atrValue : 0

    const dayOpenCandle = this.candles[this.sessionFirst.get(id) ?? i]
    const prevCandle = i > 0 ? this.candles[i - 1] : candle
    const firstIdx = this.sessionFirst.get(id) ?? i
    let halfHourClose = NaN
    for (let k = firstIdx; k <= i; k++) {
      const m = this.minutesFromOpen(this.candles[k])
      if (m >= 0 && m <= 30) halfHourClose = this.candles[k].close
      else if (m > 30) break
    }
    const firstHalfHourReturn =
      Number.isFinite(halfHourClose) && dayOpenCandle.open > 0 ? halfHourClose / dayOpenCandle.open - 1 : 0

    return {
      index: i,
      candle,
      timeframeMinutes: this.cfg.timeframeMinutes,
      sessionId: id,
      minutesFromOpen: mfo,
      phase: phaseOf(mfo, this.cfg.session),
      sessionNumber: sIdx,
      atr: atrValue,
      atrPercentile: percentileRank(this.series.atr14.slice(Math.max(0, i - 100), i + 1), atrValue),
      adx: this.series.adx14[i],
      ema20: this.series.ema20[i],
      ema50: this.series.ema50[i],
      ema200: this.series.ema200[i],
      rsi: this.series.rsi14[i],
      vwap: vw.vwap,
      vwapSd: vw.sd,
      vwapZ: vw.z,
      vwapSlope: slope,
      volumeAvg20: this.candles.slice(Math.max(0, i - 20), i).reduce((a, c) => a + c.volume, 0) / 20,
      rvolCandle: this.rvolSameTime(i),
      openingRange: this.openingRangeAt(i),
      priorHigh,
      priorLow,
      priorClose,
      dayOpen: dayOpenCandle.open,
      regime: this.regimeAt(i),
      firstHalfHourReturn,
      brokePriorHigh: priorHigh !== null && candle.close > priorHigh && prevCandle.close <= priorHigh,
      brokePriorLow: priorLow !== null && candle.close < priorLow && prevCandle.close >= priorLow,
    }
  }
}
