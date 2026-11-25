import type { GateVerdict } from '../types/edge'
import type { GateResult } from '../types/lab'
import { wilson, WILSON_Z } from './wilson'

export const EDGE_MIN_SAMPLE = 10

/** Amostra mínima para fail-fast: abaixo disso nenhum veredito é emitido. */
export const DEFAULT_KILL_N = 50
/** Amostra mínima para confirmar um edge positivo. */
export const DEFAULT_CONFIRM_N = 300
/** Multiplicador de SE do limite de KILL (p* - 2·SE). */
export const KILL_SIGMA = 2
/** Multiplicador de SE do limite de CONFIRM (p* + 3·SE). */
export const CONFIRM_SIGMA = 3

export function breakevenFor(payout: number): number {
  const safePayout = Number.isFinite(payout) ? Math.max(0, payout) : 0
  return 1 / (1 + safePayout)
}

/** Erro-padrão da taxa de acerto sob a hipótese de breakeven: SE(n)=√(p*(1-p*)/n). */
export function standardError(breakeven: number, n: number): number {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(breakeven)) return 0
  const p = Math.min(1, Math.max(0, breakeven))
  return Math.sqrt((p * (1 - p)) / n)
}

export interface EdgeThresholds {
  breakeven: number
  se: number
  /** Limite inferior: `winRate` abaixo dele dispara KILL. */
  killBound: number
  /** Limite superior: `winRate` acima dele confirma o edge. */
  confirmBound: number
}

/** Limiares do veredito para uma amostra `n` com o payout informado. */
export function edgeThresholds(payout: number, n: number): EdgeThresholds {
  const breakeven = breakevenFor(payout)
  const se = standardError(breakeven, n)
  return {
    breakeven,
    se,
    killBound: breakeven - KILL_SIGMA * se,
    confirmBound: breakeven + CONFIRM_SIGMA * se,
  }
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

function asPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/**
 * Gate rápido de dois estágios: KILL (fail-fast) e CONFIRM (edge positivo).
 * Regras, em ordem:
 *  1. n < killN → INCONCLUSIVE ("amostra insuficiente para kill").
 *  2. winRate < p* - 2·SE(n) → KILL.
 *  3. n < confirmN → INCONCLUSIVE ("amostra insuficiente para confirm").
 *  4. winRate > p* + 3·SE(n) → CONFIRM.
 *  5. caso contrário → INCONCLUSIVE ("edge não significativo").
 */
export function evaluateEdge(
  stats: { n: number; wins: number },
  payout: number,
  opts?: { killN?: number; confirmN?: number },
): GateVerdict {
  const killN = nonNegativeInt(opts?.killN, DEFAULT_KILL_N)
  const confirmN = nonNegativeInt(opts?.confirmN, DEFAULT_CONFIRM_N)
  const safeN = nonNegativeInt(stats.n, 0)
  const safeWins = safeN > 0 ? Math.min(safeN, nonNegativeInt(stats.wins, 0)) : 0
  const winRate = safeN > 0 ? safeWins / safeN : 0
  const { breakeven, se, killBound, confirmBound } = edgeThresholds(payout, safeN)

  if (safeN < killN) {
    return {
      kind: 'INCONCLUSIVE',
      reason: `Amostra insuficiente para kill: n=${safeN} < killN=${killN}.`,
      n: safeN,
      winRate,
    }
  }

  if (winRate < killBound) {
    return {
      kind: 'KILL',
      reason: `Sem vantagem: taxa de acerto ${asPercent(winRate)} abaixo de ${asPercent(killBound)} (breakeven ${asPercent(breakeven)} - ${KILL_SIGMA}·SE ${asPercent(se)}) com n=${safeN}.`,
      n: safeN,
      winRate,
    }
  }

  if (safeN < confirmN) {
    return {
      kind: 'INCONCLUSIVE',
      reason: `Amostra insuficiente para confirm: n=${safeN} < confirmN=${confirmN}.`,
      n: safeN,
      winRate,
    }
  }

  if (winRate > confirmBound) {
    return {
      kind: 'CONFIRM',
      reason: `Edge significativo: taxa de acerto ${asPercent(winRate)} acima de ${asPercent(confirmBound)} (breakeven ${asPercent(breakeven)} + ${CONFIRM_SIGMA}·SE ${asPercent(se)}) com n=${safeN}.`,
      n: safeN,
      winRate,
    }
  }

  return {
    kind: 'INCONCLUSIVE',
    reason: `Edge não significativo: taxa de acerto ${asPercent(winRate)} dentro de [${asPercent(killBound)}, ${asPercent(confirmBound)}] com n=${safeN}.`,
    n: safeN,
    winRate,
  }
}

export function edgeGate(
  wins: number,
  n: number,
  payout: number,
  z = WILSON_Z,
): GateResult {
  const safeN = Number.isFinite(n) ? Math.max(0, n) : 0
  const safeWins = safeN > 0 ? Math.min(safeN, Math.max(0, wins)) : 0
  const winRate = safeN > 0 ? safeWins / safeN : 0
  const [low, high] = wilson(winRate, safeN, z)
  const breakeven = breakevenFor(payout)

  const base = {
    n: safeN,
    wins: safeWins,
    winRate,
    low,
    high,
    breakeven,
  }

  if (safeN < EDGE_MIN_SAMPLE) {
    return {
      ...base,
      status: 'INCONCLUSIVO',
      reason: `Amostra fora da amostra com ${safeN} operações; o mínimo é ${EDGE_MIN_SAMPLE}.`,
    }
  }

  if (low > breakeven) {
    return {
      ...base,
      status: 'VALIDADO',
      reason: 'Limite inferior do IC95% acima do breakeven no teste fora da amostra.',
    }
  }

  if (high < breakeven) {
    return {
      ...base,
      status: 'SEM_VANTAGEM',
      reason: 'Limite superior do IC95% abaixo do breakeven no teste fora da amostra.',
    }
  }

  return {
    ...base,
    status: 'INCONCLUSIVO',
    reason: 'IC95% cruza o breakeven; a amostra não separa vantagem de ruído.',
  }
}
