import { describe, expect, it } from 'vitest'
import { buildSweepReclaimAnalysis, SWEEP_RECLAIM_CONFIG } from './sweepReclaim'
import type { Candle } from '../types/market'

function history(count = 25): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: (index + 1) * 60,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  }))
}

describe('Sweep & Reclaim isolado', () => {
  it('gera candidato de compra após sweep de mínima e reclaim', () => {
    const candles = history()
    candles.push({
      time: 26 * 60,
      open: 99.8,
      high: 100.1,
      low: 98.5,
      close: 100.05,
      volume: 1,
    })

    expect(buildSweepReclaimAnalysis('TEST', { closed: candles, forming: null }).signal).toMatchObject({
      phase: 'ENTRAR',
      direction: 'UP',
      triggerTime: 26 * 60,
    })
  })

  it('gera candidato de venda após sweep de máxima e reclaim', () => {
    const candles = history()
    candles.push({
      time: 26 * 60,
      open: 100.2,
      high: 101.5,
      low: 99.9,
      close: 99.95,
      volume: 1,
    })

    expect(buildSweepReclaimAnalysis('TEST', { closed: candles, forming: null }).signal).toMatchObject({
      phase: 'ENTRAR',
      direction: 'DOWN',
      triggerTime: 26 * 60,
    })
  })

  it('não sinaliza sweep sem reclaim', () => {
    const candles = history()
    candles.push({
      time: 26 * 60,
      open: 99.8,
      high: 100,
      low: 98.5,
      close: 98.8,
      volume: 1,
    })

    expect(buildSweepReclaimAnalysis('TEST', { closed: candles, forming: null }).signal.phase)
      .toBe('OBSERVANDO')
  })

  it('ignora candle em formação, mesmo quando ele completa um sweep/reclaim', () => {
    const closed = history()
    const forming: Candle = {
      time: 26 * 60,
      open: 99.8,
      high: 100.1,
      low: 98.5,
      close: 100.05,
      volume: 1,
    }

    const withoutForming = buildSweepReclaimAnalysis('TEST', { closed, forming: null })
    const withForming = buildSweepReclaimAnalysis('TEST', { closed, forming })
    expect(withForming.signal).toEqual(withoutForming.signal)
    expect(withForming.signal.phase).toBe('OBSERVANDO')
  })

  it('explica quando o histórico fechado é insuficiente', () => {
    const result = buildSweepReclaimAnalysis('TEST', {
      closed: history(SWEEP_RECLAIM_CONFIG.lookback),
      forming: null,
    })

    expect(result.signal.phase).toBe('OBSERVANDO')
    expect(result.signal.note).toMatch(/Histórico insuficiente/)
    expect(result.signal.blockedBy[0]).toMatch(/necessários/)
  })

  it('bloqueia dados inválidos com um motivo claro', () => {
    const candles = history()
    candles[0] = { ...candles[0], high: Number.NaN }
    const result = buildSweepReclaimAnalysis('TEST', { closed: candles, forming: null })

    expect(result.signal.phase).toBe('OBSERVANDO')
    expect(result.signal.note).toMatch(/inválidos/)
  })
})
