import { describe, expect, it } from 'vitest'
import { findAsset } from '../../../data/assets'
import {
  DEFAULT_TIE_TOLERANCE,
  TIE_AS_EMPATE,
  resolveOutcome,
} from '../resolveOutcome'

const EURUSD = findAsset('EURUSD') // pipSize 0.0001 / tickSize 0.00001

describe('resolveOutcome · EMPATE por tolerância de tick', () => {
  it('trata entrada == saída exata como EMPATE com PnL 0', () => {
    const entry = 1.1758
    const { result, pnl } = resolveOutcome(entry, entry, 'UP', 0.85, {
      stake: 10,
      tickSize: EURUSD.tickSize,
    })

    expect(TIE_AS_EMPATE).toBe(true)
    expect(result).toBe('TIE')
    expect(pnl).toBe(0)
  })

  it('trata saída dentro de 1 tick da entrada como EMPATE com PnL 0', () => {
    expect(DEFAULT_TIE_TOLERANCE).toBe(1)

    const entry = 1.1758
    const withinOneTick = entry + EURUSD.tickSize * (DEFAULT_TIE_TOLERANCE * 0.9)
    const { result, pnl } = resolveOutcome(entry, withinOneTick, 'UP', 0.85, {
      stake: 10,
      tickSize: EURUSD.tickSize,
    })

    expect(result).toBe('TIE')
    expect(pnl).toBe(0)
  })

  it('mantém a regra direcional a 1.1 tick de distância', () => {
    const entry = 1.1758
    const beyond = entry + EURUSD.tickSize * 1.1

    const up = resolveOutcome(entry, beyond, 'UP', 0.85, {
      stake: 10,
      tickSize: EURUSD.tickSize,
    })
    expect(up.result).toBe('WIN')
    expect(up.pnl).toBeCloseTo(8.5, 10)

    const down = resolveOutcome(entry, beyond, 'DOWN', 0.85, {
      stake: 10,
      tickSize: EURUSD.tickSize,
    })
    expect(down.result).toBe('LOSS')
    expect(down.pnl).toBe(-10)
  })
})
