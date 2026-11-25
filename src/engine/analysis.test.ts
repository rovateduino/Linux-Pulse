import { describe, expect, it } from 'vitest'
import { forcedSignalView } from './analysis'
import type { Candle } from '../types/market'

const candle: Candle = {
  time: 600,
  open: 1,
  high: 1.1,
  low: 0.99,
  close: 1.1,
  volume: 1,
}

describe('forcedSignalView', () => {
  it('forces a direction from the latest closed candle', () => {
    const signal = forcedSignalView([candle])

    expect(signal.phase).toBe('ENTRAR')
    expect(signal.direction).toBe('UP')
    expect(signal.triggerTime).toBe(candle.time)
  })

  it('does not create an order direction for an empty or neutral candle', () => {
    const neutral = forcedSignalView([{ ...candle, close: candle.open }])

    expect(forcedSignalView([])).toMatchObject({
      phase: 'OBSERVANDO',
      direction: null,
      triggerTime: null,
    })
    expect(neutral).toMatchObject({
      phase: 'OBSERVANDO',
      direction: null,
      triggerTime: null,
    })
  })
})
