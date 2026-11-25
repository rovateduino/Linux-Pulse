import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIRM_N,
  DEFAULT_KILL_N,
  EDGE_MIN_SAMPLE,
  breakevenFor,
  edgeGate,
  edgeThresholds,
  evaluateEdge,
  standardError,
} from '../edgeGate'

const PAYOUT = 0.85
const P_STAR = 1 / (1 + PAYOUT)

describe('breakevenFor', () => {
  it('converte payout em taxa de acerto de equilíbrio', () => {
    expect(breakevenFor(PAYOUT)).toBeCloseTo(0.5405, 4)
    expect(breakevenFor(0)).toBe(1)
    expect(breakevenFor(Number.NaN)).toBe(1)
  })
})

describe('edgeGate', () => {
  it('uses the reduced local sample threshold of 10', () => {
    expect(EDGE_MIN_SAMPLE).toBe(10)
    expect(edgeGate(9, 9, PAYOUT).reason).toContain('mínimo é 10')
    expect(edgeGate(10, 10, PAYOUT).status).toBe('VALIDADO')
  })

  it('VALIDA com amostra mínima e limite inferior acima do breakeven', () => {
    const gate = edgeGate(700, 1000, PAYOUT)
    expect(gate.status).toBe('VALIDADO')
    expect(gate.n).toBe(1000)
    expect(gate.low).toBeGreaterThan(gate.breakeven)
    expect(gate.reason).toContain('IC95%')
  })

  it('INCONCLUSIVO abaixo do tamanho mínimo, mesmo com 100% de acerto', () => {
    const gate = edgeGate(EDGE_MIN_SAMPLE - 1, EDGE_MIN_SAMPLE - 1, PAYOUT)
    expect(gate.status).toBe('INCONCLUSIVO')
    expect(gate.reason).toContain(String(EDGE_MIN_SAMPLE))
  })

  it('SEM_VANTAGEM quando o limite superior fica abaixo do breakeven', () => {
    const gate = edgeGate(400, 1000, PAYOUT)
    expect(gate.status).toBe('SEM_VANTAGEM')
    expect(gate.high).toBeLessThan(gate.breakeven)
  })

  it('INCONCLUSIVO quando o IC cruza o breakeven', () => {
    const gate = edgeGate(540, 1000, PAYOUT)
    expect(gate.status).toBe('INCONCLUSIVO')
    expect(gate.low).toBeLessThan(gate.breakeven)
    expect(gate.high).toBeGreaterThan(gate.breakeven)
  })

  it('não valida amostra vazia', () => {
    const gate = edgeGate(0, 0, PAYOUT)
    expect(gate.status).toBe('INCONCLUSIVO')
    expect(gate.n).toBe(0)
    expect(gate.winRate).toBe(0)
  })

  it('limita acertos ao tamanho da amostra', () => {
    const gate = edgeGate(1200, 1000, PAYOUT)
    expect(gate.wins).toBe(1000)
    expect(gate.winRate).toBe(1)
    expect(gate.status).toBe('VALIDADO')
  })
})

describe('standardError', () => {
  it('decresce conforme n cresce (propriedade)', () => {
    expect(standardError(P_STAR, 400)).toBeLessThan(standardError(P_STAR, 300))
    expect(standardError(P_STAR, 300)).toBeLessThan(standardError(P_STAR, 50))
  })

  it('devolve 0 para amostra vazia', () => {
    expect(standardError(P_STAR, 0)).toBe(0)
  })
})

describe('edgeThresholds', () => {
  it('deriva os limites de p* ∓ k·SE', () => {
    const { breakeven, se, killBound, confirmBound } = edgeThresholds(PAYOUT, 300)
    expect(breakeven).toBeCloseTo(P_STAR, 12)
    expect(se).toBeCloseTo(Math.sqrt((P_STAR * (1 - P_STAR)) / 300), 12)
    expect(killBound).toBeCloseTo(breakeven - 2 * se, 12)
    expect(confirmBound).toBeCloseTo(breakeven + 3 * se, 12)
  })
})

describe('evaluateEdge', () => {
  it('usa os defaults killN=50 e confirmN=300', () => {
    expect(DEFAULT_KILL_N).toBe(50)
    expect(DEFAULT_CONFIRM_N).toBe(300)
  })

  it('n=30 com qualquer winRate → INCONCLUSIVE (regra 1)', () => {
    const low = evaluateEdge({ n: 30, wins: 0 }, PAYOUT)
    const high = evaluateEdge({ n: 30, wins: 30 }, PAYOUT)
    expect(low.kind).toBe('INCONCLUSIVE')
    expect(high.kind).toBe('INCONCLUSIVE')
    expect(low.n).toBe(30)
    expect(low.reason).toContain('insuficiente para kill')
  })

  it('n=50 com winRate abaixo de p*-2·SE → KILL (regra 2)', () => {
    const verdict = evaluateEdge({ n: 50, wins: 19 }, PAYOUT)
    expect(verdict.kind).toBe('KILL')
    expect(verdict.n).toBe(50)
    expect(verdict.winRate).toBeCloseTo(0.38, 12)
    expect(verdict.winRate).toBeLessThan(P_STAR - 2 * standardError(P_STAR, 50))
  })

  it('fronteira: n=50 com winRate=0.40 fica em INCONCLUSIVE', () => {
    // O ticket citava 0.40 como KILL; pela fórmula exata 0.40 > p*-2·SE(50)=0.39958.
    const verdict = evaluateEdge({ n: 50, wins: 20 }, PAYOUT)
    expect(verdict.winRate).toBeCloseTo(0.4, 12)
    expect(verdict.kind).toBe('INCONCLUSIVE')
    expect(verdict.reason).toContain('insuficiente para confirm')
  })

  it('n=300 com winRate≈0.545 → INCONCLUSIVE (regra 5, não passa 3·SE)', () => {
    const verdict = evaluateEdge({ n: 300, wins: 163 }, PAYOUT)
    expect(verdict.kind).toBe('INCONCLUSIVE')
    expect(verdict.n).toBe(300)
    expect(verdict.winRate).toBeLessThan(P_STAR + 3 * standardError(P_STAR, 300))
    expect(verdict.reason).toContain('não significativo')
  })

  it('n=300 com winRate=0.65 → CONFIRM (regra 4)', () => {
    const verdict = evaluateEdge({ n: 300, wins: 195 }, PAYOUT)
    expect(verdict.kind).toBe('CONFIRM')
    expect(verdict.winRate).toBeCloseTo(0.65, 12)
    expect(verdict.winRate).toBeGreaterThan(P_STAR + 3 * standardError(P_STAR, 300))
  })

  it('n=400 com winRate=0.55 → INCONCLUSIVE (regra 5)', () => {
    const verdict = evaluateEdge({ n: 400, wins: 220 }, PAYOUT)
    expect(verdict.kind).toBe('INCONCLUSIVE')
    expect(verdict.winRate).toBeCloseTo(0.55, 12)
  })

  it('nunca dispara KILL quando winRate > p* (propriedade)', () => {
    for (const n of [50, 75, 120, 300, 400, 1000]) {
      const wins = Math.floor(P_STAR * n) + 1
      const verdict = evaluateEdge({ n, wins }, PAYOUT)
      expect(verdict.kind).not.toBe('KILL')
    }
  })

  it('respeita killN/confirmN customizados', () => {
    expect(evaluateEdge({ n: 12, wins: 12 }, PAYOUT).kind).toBe('INCONCLUSIVE')
    expect(
      evaluateEdge({ n: 12, wins: 12 }, PAYOUT, { killN: 5, confirmN: 10 }).kind,
    ).toBe('CONFIRM')
  })

  it('trata amostra vazia como INCONCLUSIVE', () => {
    const verdict = evaluateEdge({ n: 0, wins: 0 }, PAYOUT)
    expect(verdict.kind).toBe('INCONCLUSIVE')
    expect(verdict.n).toBe(0)
    expect(verdict.winRate).toBe(0)
  })
})
