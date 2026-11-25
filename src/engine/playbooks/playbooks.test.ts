import { describe, expect, it } from 'vitest'
import { findAsset } from '../../data/assets'
import type { Candle } from '../../types/market'
import { evaluateC } from './playbookC'

const CFG = findAsset('EURUSD')
const STEP = 300
// 08:00 UTC está dentro da janela London (07:00–11:00) de DEFAULT_SESSIONS.
const TRIGGER_TIME = Date.UTC(2026, 0, 5, 8, 0, 0)
const OFF_SESSION_TIME = Date.UTC(2026, 0, 5, 3, 0, 0)

function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1 }
}

/** `count` candles com o último (trigger) em TRIGGER_TIME. */
function series(build: (k: number, time: number) => Candle, count: number): Candle[] {
  const candles: Candle[] = []
  for (let k = 0; k < count; k += 1) {
    candles.push(build(k, TRIGGER_TIME - (count - 1 - k) * STEP))
  }
  return candles
}

function breakoutBuy(): Candle[] {
  return series((k, t) => {
    if (k < 71) {
      const close = k % 2 === 1 ? 1.0005 : 1.0
      const open = k === 0 ? 1.0 : k % 2 === 1 ? 1.0 : 1.0005
      return candle(t, open, Math.max(open, close) + 0.00002, Math.min(open, close) - 0.00002, close)
    }
    return candle(t, 1.0, 1.002, 0.9999, 1.002)
  }, 72)
}

function breakoutSell(): Candle[] {
  return series((k, t) => {
    if (k < 71) {
      const close = k % 2 === 1 ? 0.9995 : 1.0
      const open = k === 0 ? 1.0 : k % 2 === 1 ? 1.0 : 0.9995
      return candle(t, open, Math.max(open, close) + 0.00002, Math.min(open, close) - 0.00002, close)
    }
    return candle(t, 1.0, 1.0001, 0.998, 0.998)
  }, 72)
}

function breakoutAtrFail(): Candle[] {
  return series((k, t) => {
    if (k <= 40) {
      const close = k % 2 === 1 ? 1.01 : 1.0
      const open = k === 0 ? 1.0 : k % 2 === 1 ? 1.0 : 1.01
      return candle(t, open, Math.max(open, close) + 0.005, Math.min(open, close) - 0.005, close)
    }
    if (k <= 70) {
      const close = k % 2 === 1 ? 1.0201 : 1.02
      const open = k % 2 === 1 ? 1.02 : 1.0201
      return candle(t, open, Math.max(open, close) + 0.00002, Math.min(open, close) - 0.00002, close)
    }
    return candle(t, 1.02, 1.022, 1.0199, 1.022)
  }, 72)
}

describe('evaluateC · momentum de sessão', () => {
  it('gera sinal de compra quando as 4 condições batem', () => {
    const signal = evaluateC(breakoutBuy(), 71, CFG)
    expect(signal).not.toBeNull()
    expect(signal?.playbook).toBe('C')
    expect(signal?.direction).toBe('UP')
    expect(signal?.conditions.every((condition) => condition.met)).toBe(true)
    expect(signal?.exits).toEqual({ takeProfitAtr: 1.0, stopLossAtr: 0.7 })
  })

  it('gera sinal de venda simétrico', () => {
    const signal = evaluateC(breakoutSell(), 71, CFG)
    expect(signal?.direction).toBe('DOWN')
    expect(signal?.conditions.every((condition) => condition.met)).toBe(true)
  })

  it('não gera sinal se corpo/range = 0.55 (falha na força)', () => {
    const candles = breakoutBuy()
    const trigger = candles[71]
    // body = 0,002; range = 0,002/0,55 ≈ 0,003636 → ratio = 0,55.
    candles[71] = candle(
      trigger.time,
      trigger.open,
      trigger.high,
      trigger.high - 0.002 / 0.55,
      trigger.close,
    )
    expect(evaluateC(candles, 71, CFG)).toBeNull()
  })

  it('não gera sinal se ATR <= SMA(ATR) (falha na volatilidade)', () => {
    expect(evaluateC(breakoutAtrFail(), 71, CFG)).toBeNull()
  })

  it('não gera sinal fora do filtro de sessão', () => {
    const candles = breakoutBuy()
    candles[71] = { ...candles[71], time: OFF_SESSION_TIME }
    expect(evaluateC(candles, 71, CFG)).toBeNull()
  })
})
