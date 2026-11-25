import { describe, expect, it } from 'vitest'
import { classifyMetrics, classifyRegime } from './regime'
import type { Candle } from '../types/market'

function trendCandles(count: number): Candle[] {
  const candles: Candle[] = []
  for (let index = 0; index < count; index += 1) {
    const close = 100 + index
    const open = index === 0 ? close : 100 + index - 1
    candles.push({
      time: index * 300,
      open,
      high: close + 0.4,
      low: close - 0.4,
      close,
      volume: 1,
    })
  }
  return candles
}

describe('classifyMetrics', () => {
  it('exige ADX, inclinação e alinhamento para tendência', () => {
    expect(
      classifyMetrics({ adx: 25, slope: 0.3, bandwidthPct: 80, emaAligned: true, alignedUp: true }),
    ).toBe('TENDENCIA')
    expect(
      classifyMetrics({ adx: 24.9, slope: 0.3, bandwidthPct: 80, emaAligned: true, alignedUp: true }),
    ).toBe('SEM_REGIME')
    expect(
      classifyMetrics({ adx: 30, slope: 0.2, bandwidthPct: 80, emaAligned: true, alignedUp: true }),
    ).toBe('SEM_REGIME')
    expect(
      classifyMetrics({ adx: 30, slope: 0.5, bandwidthPct: 80, emaAligned: false, alignedUp: false }),
    ).toBe('SEM_REGIME')
  })

  it('classifica lateral com compressão e baixa inclinação', () => {
    expect(
      classifyMetrics({ adx: 17.9, slope: 0.1, bandwidthPct: 40, emaAligned: false, alignedUp: false }),
    ).toBe('LATERAL')
    expect(
      classifyMetrics({ adx: 18, slope: 0.1, bandwidthPct: 40, emaAligned: false, alignedUp: false }),
    ).toBe('SEM_REGIME')
    expect(
      classifyMetrics({ adx: 10, slope: 0.1, bandwidthPct: 41, emaAligned: false, alignedUp: false }),
    ).toBe('SEM_REGIME')
    expect(
      classifyMetrics({ adx: 10, slope: 0.2, bandwidthPct: 20, emaAligned: false, alignedUp: false }),
    ).toBe('SEM_REGIME')
  })
})

describe('classifyRegime', () => {
  it('retorna SEM_REGIME com histórico insuficiente', () => {
    expect(classifyRegime(trendCandles(199)).kind).toBe('SEM_REGIME')
  })

  it('detecta tendência de alta no pipeline completo', () => {
    const regime = classifyRegime(trendCandles(400))
    expect(regime.kind).toBe('TENDENCIA')
    expect(regime.direction).toBe('UP')
    expect(regime.emaAligned).toBe(true)
    expect(regime.adx).toBeGreaterThan(25)
  })
})
