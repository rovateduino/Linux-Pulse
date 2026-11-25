import { describe, expect, it } from 'vitest'
import { WILSON_Z, wilson } from '../wilson'

describe('wilson', () => {
  it('reproduz o intervalo de 55% em 300 operações', () => {
    const [low, high] = wilson(0.55, 300)
    expect(low).toBeCloseTo(0.493, 2)
    expect(high).toBeCloseTo(0.605, 2)
  })

  it('usa z de 95% por padrão', () => {
    expect(WILSON_Z).toBe(1.96)
    expect(wilson(0.55, 300, 1.96)).toEqual(wilson(0.55, 300))
  })

  it('devolve intervalo degenerado sem amostra', () => {
    expect(wilson(0.5, 0)).toEqual([0, 0])
    expect(wilson(0.5, -10)).toEqual([0, 0])
    expect(wilson(0.5, Number.NaN)).toEqual([0, 0])
    expect(wilson(Number.NaN, 10)).toEqual([0, 0])
  })

  it('alarga o intervalo em amostras pequenas', () => {
    const [smallLow, smallHigh] = wilson(0.8, 5)
    const [largeLow, largeHigh] = wilson(0.8, 500)
    expect(smallHigh - smallLow).toBeGreaterThan(largeHigh - largeLow)
    expect(smallLow).toBeLessThan(0.8)
    expect(smallHigh).toBeGreaterThan(0.8)
  })

  it('trata proporções nos extremos', () => {
    const [zeroLow, zeroHigh] = wilson(0, 300)
    expect(zeroLow).toBe(0)
    expect(zeroHigh).toBeGreaterThan(0)
    expect(zeroHigh).toBeLessThan(0.05)

    const [oneLow, oneHigh] = wilson(1, 300)
    expect(oneHigh).toBeCloseTo(1, 12)
    expect(oneLow).toBeGreaterThan(0.95)
    expect(oneLow).toBeLessThan(1)
  })

  it('limita proporções fora de [0,1]', () => {
    expect(wilson(-2, 100)).toEqual(wilson(0, 100))
    expect(wilson(3, 100)).toEqual(wilson(1, 100))
  })
})
