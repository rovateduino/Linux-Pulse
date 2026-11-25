import type { Candle } from './types.js'

/** EMA classica. Retorna array alinhado ao input (NaN antes do warmup). */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let acc = 0
  for (let i = 0; i < period; i++) acc += values[i]
  out[period - 1] = acc / period
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k)
  }
  return out
}

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let acc = 0
  for (let i = 0; i < values.length; i++) {
    acc += values[i]
    if (i >= period) acc -= values[i - period]
    if (i >= period - 1) out[i] = acc / period
  }
  return out
}

/** ATR de Wilder. */
export function atr(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN)
  if (candles.length <= period) return out
  const tr: number[] = [NaN]
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]
    const p = candles[i - 1]
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)))
  }
  let acc = 0
  for (let i = 1; i <= period; i++) acc += tr[i]
  out[period] = acc / period
  for (let i = period + 1; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
  }
  return out
}

/** ADX de Wilder com +DI/-DI. */
export function adx(candles: Candle[], period = 14): { adx: number[]; plusDi: number[]; minusDi: number[] } {
  const n = candles.length
  const outAdx = new Array<number>(n).fill(NaN)
  const plusDi = new Array<number>(n).fill(NaN)
  const minusDi = new Array<number>(n).fill(NaN)
  if (n <= period * 2) return { adx: outAdx, plusDi, minusDi }

  const tr: number[] = [0]
  const plusDm: number[] = [0]
  const minusDm: number[] = [0]
  for (let i = 1; i < n; i++) {
    const c = candles[i]
    const p = candles[i - 1]
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)))
    const up = c.high - p.high
    const down = p.low - c.low
    plusDm.push(up > down && up > 0 ? up : 0)
    minusDm.push(down > up && down > 0 ? down : 0)
  }

  let trS = 0
  let pS = 0
  let mS = 0
  for (let i = 1; i <= period; i++) {
    trS += tr[i]
    pS += plusDm[i]
    mS += minusDm[i]
  }

  const dx: number[] = new Array<number>(n).fill(NaN)
  const push = (i: number) => {
    const pdi = trS === 0 ? 0 : (100 * pS) / trS
    const mdi = trS === 0 ? 0 : (100 * mS) / trS
    plusDi[i] = pdi
    minusDi[i] = mdi
    const sum = pdi + mdi
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum
  }

  push(period)
  for (let i = period + 1; i < n; i++) {
    trS = trS - trS / period + tr[i]
    pS = pS - pS / period + plusDm[i]
    mS = mS - mS / period + minusDm[i]
    push(i)
  }

  // primeiro ADX = media simples dos primeiros `period` DX
  let acc = 0
  let count = 0
  for (let i = period; i < period * 2 && i < n; i++) {
    if (!Number.isNaN(dx[i])) {
      acc += dx[i]
      count++
    }
  }
  if (count === 0) return { adx: outAdx, plusDi, minusDi }
  outAdx[period * 2 - 1] = acc / count
  for (let i = period * 2; i < n; i++) {
    outAdx[i] = (outAdx[i - 1] * (period - 1) + dx[i]) / period
  }
  return { adx: outAdx, plusDi, minusDi }
}

export function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  let ag = gain / period
  let al = loss / period
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    const g = d > 0 ? d : 0
    const l = d < 0 ? -d : 0
    ag = (ag * (period - 1) + g) / period
    al = (al * (period - 1) + l) / period
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return out
}

export interface VwapState {
  vwap: number
  sd: number
  z: number
}

/**
 * VWAP de sessao com desvio ponderado por volume.
 * `candles` deve conter apenas candles da sessao corrente, em ordem.
 * Ignora o ultimo candle se ele estiver em formacao (o chamador decide).
 */
export function vwap(candles: Candle[]): VwapState {
  let pv = 0
  let p2v = 0
  let vol = 0
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3
    const v = Math.max(c.volume, 0)
    pv += tp * v
    p2v += tp * tp * v
    vol += v
  }
  if (vol <= 0) {
    const last = candles.length ? candles[candles.length - 1].close : NaN
    return { vwap: last, sd: 0, z: 0 }
  }
  const mean = pv / vol
  const variance = Math.max(p2v / vol - mean * mean, 0)
  const sd = Math.sqrt(variance)
  const last = candles[candles.length - 1].close
  return { vwap: mean, sd, z: sd > 0 ? (last - mean) / sd : 0 }
}

/** Percentil (0..1) de `value` dentro de `series`, ignorando NaN. */
export function percentileRank(series: number[], value: number): number {
  const clean = series.filter((v) => !Number.isNaN(v))
  if (clean.length === 0) return 0.5
  let below = 0
  for (const v of clean) if (v <= value) below++
  return below / clean.length
}

export function stdev(values: number[]): number {
  const clean = values.filter((v) => !Number.isNaN(v))
  if (clean.length < 2) return 0
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length
  const v = clean.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (clean.length - 1)
  return Math.sqrt(v)
}

export function lastDefined(values: number[], fallback = NaN): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (!Number.isNaN(values[i])) return values[i]
  }
  return fallback
}
