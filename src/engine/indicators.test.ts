import { describe, expect, it } from 'vitest'
import {
  adx,
  atr,
  bandwidthPercentile,
  bollinger,
  ema,
  normalizedSlope,
  percentileRank,
  rsi,
} from './indicators'
import type { Candle } from '../types/market'

function candle(close: number, high = close + 1, low = close - 1, open = close): Candle {
  return { time: 0, open, high, low, close, volume: 0 }
}

describe('ema', () => {
  it('usa SMA como semente e aplica 2/(período+1)', () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it('retorna nulos quando não há amostra suficiente', () => {
    expect(ema([1, 2], 3)).toEqual([null, null])
  })

  it('permanece constante em série constante', () => {
    expect(ema([5, 5, 5, 5, 5], 3)).toEqual([null, null, 5, 5, 5])
  })
})

describe('rsi', () => {
  it('marca 100 em sequência apenas de altas', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1)
    const output = rsi(values, 14)
    expect(output[13]).toBeNull()
    expect(output[14]).toBe(100)
  })

  it('marca 0 em sequência apenas de baixas', () => {
    const values = Array.from({ length: 20 }, (_, index) => 20 - index)
    expect(rsi(values, 14)[14]).toBe(0)
  })
})

describe('atr', () => {
  it('usa true range e suavização de Wilder', () => {
    const candles = Array.from({ length: 20 }, () => candle(100, 101, 99))
    const output = atr(candles, 14)
    expect(output[13]).toBeNull()
    expect(output[14]).toBeCloseTo(2, 10)
    expect(output[19]).toBeCloseTo(2, 10)
  })

  it('reage a gap com true range', () => {
    const candles = [candle(100, 101, 99), candle(110, 111, 109)]
    expect(atr(candles, 1)[1]).toBe(11)
  })
})

describe('adx', () => {
  it('permanece zero em mercado lateral', () => {
    const candles = Array.from({ length: 40 }, () => candle(100, 101, 99))
    const output = adx(candles, 14).adx
    expect(output[27]).toBe(0)
  })

  it('detecta direção dominante em tendência de alta', () => {
    const candles = Array.from({ length: 40 }, (_, index) => {
      const close = 100 + index
      return candle(close, close + 0.5, close - 0.5, close - 0.5)
    })
    const result = adx(candles, 14)
    const last = candles.length - 1
    expect(result.adx[last]).not.toBeNull()
    expect(result.plusDi[last]!).toBeGreaterThan(result.minusDi[last]!)
    expect(result.adx[last]!).toBeGreaterThan(25)
  })
})

describe('bollinger', () => {
  it('colapsa as bandas em série constante', () => {
    const values = Array.from({ length: 25 }, () => 5)
    const bands = bollinger(values, 20, 2)
    expect(bands.middle[24]).toBe(5)
    expect(bands.upper[24]).toBe(5)
    expect(bands.lower[24]).toBe(5)
    expect(bands.bandwidth[24]).toBe(0)
  })
})

describe('percentileRank', () => {
  it('calcula posto percentual inclusivo', () => {
    expect(percentileRank([1, 2, 3], 0)).toBe(0)
    expect(percentileRank([1, 2, 3], 2)).toBeCloseTo(66.666, 2)
    expect(percentileRank([1, 2, 3], 3)).toBe(100)
    expect(percentileRank([], 1)).toBeNull()
  })

  it('recorta a janela de bandwidth', () => {
    const bandwidth = [0.1, 0.2, 0.3, 0.05]
    expect(bandwidthPercentile(bandwidth, 3, 3)).toBeCloseTo(33.333, 2)
  })
})

describe('normalizedSlope', () => {
  it('normaliza a variação da EMA pelo ATR', () => {
    const series = [null, 10, null, null, null, null, 11]
    const volatility = [null, null, null, null, null, null, 2]
    expect(normalizedSlope(series, volatility, 5, 6)).toBe(0.5)
  })
})
