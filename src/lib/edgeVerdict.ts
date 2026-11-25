import {
  CONFIRM_SIGMA,
  DEFAULT_CONFIRM_N,
  DEFAULT_KILL_N,
  KILL_SIGMA,
  edgeThresholds,
} from '../engine/edgeGate'
import type { GateVerdict, GateVerdictKind } from '../types/edge'

export const VERDICT_LABEL: Record<GateVerdictKind, string> = {
  KILL: 'KILL',
  INCONCLUSIVE: 'INCONCLUSIVO',
  CONFIRM: 'CONFIRM',
}

/** Vermelho KILL · cinza INCONCLUSIVE · verde CONFIRM. */
export const VERDICT_BADGE_CLASS: Record<GateVerdictKind, string> = {
  KILL: 'border-sell/30 bg-sell/[0.08] text-sell',
  INCONCLUSIVE: 'border-line bg-white/[0.03] text-muted',
  CONFIRM: 'border-buy/30 bg-buy/[0.08] text-buy',
}

const pctFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function pct(value: number): string {
  return `${pctFormat.format(value * 100)}%`
}

/** Tooltip auditável: n, winRate, SE e os limites de KILL/CONFIRM. */
export function verdictTooltip(verdict: GateVerdict, payout: number): string {
  const { breakeven, se, killBound, confirmBound } = edgeThresholds(payout, verdict.n)
  return [
    `${VERDICT_LABEL[verdict.kind]} — ${verdict.reason}`,
    `n = ${verdict.n}`,
    `Taxa de acerto = ${pct(verdict.winRate)}`,
    `Breakeven p* = ${pct(breakeven)}`,
    `SE(n) = ${pct(se)}`,
    `KILL se acerto < ${pct(killBound)} (p* - ${KILL_SIGMA}·SE)`,
    `CONFIRM se acerto > ${pct(confirmBound)} (p* + ${CONFIRM_SIGMA}·SE)`,
    `killN = ${DEFAULT_KILL_N} · confirmN = ${DEFAULT_CONFIRM_N}`,
  ].join('\n')
}
