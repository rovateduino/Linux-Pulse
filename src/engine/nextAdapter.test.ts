import { describe, expect, it } from 'vitest'
import { toEngineCandles } from './nextAdapter'
import type { Candle } from '../types/market'

function candles(count: number, stepSeconds: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const price = 1 + index * 0.0001
    return {
      time: 1_700_000_000 + index * stepSeconds,
      open: price,
      high: price + 0.0002,
      low: price - 0.0002,
      close: price + 0.0001,
      volume: 1,
    }
  })
}

describe('next engine candle adapter', () => {
  it('converts M1 open timestamps to UTC close timestamps', () => {
    const input = candles(50, 60)
    const output = toEngineCandles(input, 1, 0)
    const first = input[0]

    if (first === undefined) throw new Error('Teste precisa de pelo menos um candle.')
    expect(output[0]?.time).toBe((first.time + 60) * 1000)
    expect(output).toHaveLength(input.length)
  })

  it('rejects M1 data when the engine is configured for M5', () => {
    expect(() => toEngineCandles(candles(50, 60), 5, 0)).toThrow(/fora de 5m/)
  })
})
