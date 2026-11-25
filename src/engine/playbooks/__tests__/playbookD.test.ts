import { describe, expect, it } from 'vitest'
import { findAsset } from '../../../data/assets'
import { closesOf, ema } from '../../indicators'
import type { Candle } from '../../../types/market'
import { h1Ema200At, h1Ema200Series, resampleToH1 } from '../shared'
import { evaluateD } from '../playbookD'

const CFG = findAsset('EURUSD')
const STEP = 300
const TRIGGER_INDEX = 2520
// 08:00 UTC está dentro da janela London (07:00–11:00) de DEFAULT_SESSIONS.
const TRIGGER_TIME = Date.UTC(2026, 0, 5, 8, 0, 0)

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1 }
}

interface Trigger {
  o: number
  h: number
  l: number
  c: number
}

/**
 * 2521 candles M5 = 210 horas H1 completas + o candle do trigger.
 * k=0..2489: perna macro (alta para compra, baixa para venda).
 * k=2490..2519: perna de exaustão de 30 candles contra a macro.
 * k=2520: trigger na banda extrema.
 */
function fadeSeries(uptrend: boolean, trigger: Trigger): Candle[] {
  const candles: Candle[] = []
  const macroEnd = uptrend ? 0.7 + 0.00012 * 2489 : 1.3 - 0.00012 * 2489
  for (let k = 0; k <= TRIGGER_INDEX; k += 1) {
    const t = TRIGGER_TIME - (TRIGGER_INDEX - k) * STEP
    if (k === TRIGGER_INDEX) {
      candles.push(candle(t, trigger.o, trigger.h, trigger.l, trigger.c))
      continue
    }
    if (k <= 2489) {
      const close = uptrend ? 0.7 + 0.00012 * k : 1.3 - 0.00012 * k
      const open = k === 0 ? close : uptrend ? 0.7 + 0.00012 * (k - 1) : 1.3 - 0.00012 * (k - 1)
      candles.push(
        uptrend
          ? candle(t, open, close + 0.0004, open - 0.0004, close)
          : candle(t, open, open + 0.0004, close - 0.0004, close),
      )
      continue
    }
    const dir = uptrend ? -1 : 1
    const close = macroEnd + dir * 0.003 * (k - 2489)
    const open = macroEnd + dir * 0.003 * (k - 2490)
    candles.push(
      candle(t, open, Math.max(open, close) + 0.0004, Math.min(open, close) - 0.0004, close),
    )
  }
  return candles
}

// Compra em uptrend: pullback até a banda inferior, RSI ~16, candle de alta.
function fadeBuy(): Candle[] {
  return fadeSeries(true, { o: 0.9, h: 0.94, l: 0.885, c: 0.915 })
}

// Mesmo setup com repique maior: RSI ≈ 32 (ainda < 35).
function fadeBuyRsiMid(): Candle[] {
  return fadeSeries(true, { o: 0.9, h: 0.94, l: 0.885, c: 0.925 })
}

// Repique forte demais: RSI ≈ 38 (> 35) — fora do extremo.
function fadeBuyRsiHigh(): Candle[] {
  return fadeSeries(true, { o: 0.9, h: 0.945, l: 0.885, c: 0.93 })
}

// Toca a banda mas fecha em baixa: não é candle de reversão de compra.
function fadeBuyBearish(): Candle[] {
  return fadeSeries(true, { o: 0.92, h: 0.925, l: 0.885, c: 0.91 })
}

// Mesmo setup de compra perfeito, mas sobre tendência de BAIXA:
// fechamento (0.925) fica abaixo da EMA200 H1 (~1.14) → sinal bloqueado.
function fadeBuyCounterTrend(): Candle[] {
  return fadeSeries(false, { o: 0.9, h: 0.94, l: 0.885, c: 0.925 })
}

// Venda em downtrend: repique até a banda superior, RSI ~84, candle de baixa.
function fadeSell(): Candle[] {
  return fadeSeries(false, { o: 1.1, h: 1.12, l: 1.06, c: 1.085 })
}

// Repique fraco: RSI ≈ 62 (< 65) — fora do extremo para venda.
function fadeSellRsiLow(): Candle[] {
  return fadeSeries(false, { o: 1.095, h: 1.115, l: 1.055, c: 1.07 })
}

describe('evaluateD v2 · reversão em extremos + EMA200 H1', () => {
  it('gera sinal de compra no toque da BB inferior + RSI < 35 + candle de alta acima da EMA200 H1', () => {
    const signal = evaluateD(fadeBuy(), TRIGGER_INDEX, CFG)
    expect(signal).not.toBeNull()
    expect(signal?.playbook).toBe('D')
    expect(signal?.direction).toBe('UP')
    expect(signal?.conditions.every((condition) => condition.met)).toBe(true)
    expect(signal?.exits).toEqual({ takeProfitAtr: 0.8, stopLossAtr: 0.8 })
  })

  it('gera sinal de venda simétrico (abaixo da EMA200 H1 + RSI > 65 + candle de baixa)', () => {
    const signal = evaluateD(fadeSell(), TRIGGER_INDEX, CFG)
    expect(signal?.direction).toBe('DOWN')
    expect(signal?.conditions.every((condition) => condition.met)).toBe(true)
  })

  it('gera sinal com RSI ≈ 32 (limite flexível < 35)', () => {
    const signal = evaluateD(fadeBuyRsiMid(), TRIGGER_INDEX, CFG)
    expect(signal?.direction).toBe('UP')
    expect(signal?.conditions.every((condition) => condition.met)).toBe(true)
  })

  it('não gera sinal se RSI ≈ 38 na compra (falha no extremo)', () => {
    expect(evaluateD(fadeBuyRsiHigh(), TRIGGER_INDEX, CFG)).toBeNull()
  })

  it('não gera sinal se RSI ≈ 62 na venda (falha no extremo)', () => {
    expect(evaluateD(fadeSellRsiLow(), TRIGGER_INDEX, CFG)).toBeNull()
  })

  it('não gera sinal se o candle do toque não é de reversão', () => {
    expect(evaluateD(fadeBuyBearish(), TRIGGER_INDEX, CFG)).toBeNull()
  })

  it('BLOQUEIA compra perfeita contra a tendência (fechamento abaixo da EMA200 H1)', () => {
    const signal = evaluateD(fadeBuyCounterTrend(), TRIGGER_INDEX, CFG)
    expect(signal).toBeNull()
  })
})

describe('h1Ema200At · ausência de look-ahead', () => {
  // 2521 candles alinhados à hora, close distinto por bucket H1.
  function hourlySeries(): Candle[] {
    const candles: Candle[] = []
    const start = TRIGGER_TIME - TRIGGER_INDEX * STEP // 08:00 - 2520*300s = hora cheia
    for (let k = 0; k <= TRIGGER_INDEX; k += 1) {
      const hour = Math.floor(k / 12)
      const t = start + k * STEP
      candles.push(candle(t, 1 + hour * 0.001, 1 + hour * 0.001 + 0.0002, 1 + hour * 0.001 - 0.0002, 1 + hour * 0.001))
    }
    return candles
  }

  it('usa a EMA200 do último H1 fechado, nunca do H1 em formação', () => {
    const candles = hourlySeries()
    const h1 = h1Ema200Series(candles).candles
    // Referência independente: EMA(200) sobre closes H1 reamostrados.
    const expected = ema(closesOf(resampleToH1(candles)), 200)

    expect(h1.length).toBeGreaterThan(200)

    // k=2465 está na hora 205 (2465/12 = 205.4): último H1 fechado = 204.
    expect(h1Ema200At(candles, 2465)).toBe(expected[204])
    // k=2460 é o PRIMEIRO M5 da hora 205: o H1 da hora 205 ainda não fechou.
    expect(h1Ema200At(candles, 2460)).toBe(expected[204])
    // k=2472 abre a hora 206: agora o H1 205 está fechado e entra na EMA.
    expect(h1Ema200At(candles, 2472)).toBe(expected[205])
    // Trigger (k=2520, 08:00): último H1 fechado = o das 07:00–08:00.
    expect(h1Ema200At(candles, TRIGGER_INDEX)).toBe(expected[h1.length - 2])
    // Sanidade: EMA dos buckets 204 e 205 difere (série estritamente crescente).
    expect(expected[204]).not.toBe(expected[205])
  })
})
