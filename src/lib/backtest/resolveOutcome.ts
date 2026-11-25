import type { CandleDirection, TradeOutcome } from '../../types/market'

/**
 * Tolerância padrão de empate, em ticks (pipettes).
 *
 * Em opções binárias, uma saída praticamente no mesmo preço da entrada é
 * EMPATE (devolução da stake), não ganho. Usamos 1 tick (1/10 do pip) para
 * cobrir apenas o arredondamento de cotação, sem mascarar movimentos reais
 * de 1 pip — que continuam contando como ACERTO/ERRO.
 */
export const DEFAULT_TIE_TOLERANCE = 1

/**
 * Feature flag de rollback: quando `false`, volta ao comportamento antigo
 * (EMPATE só em igualdade exata `exit === entry`).
 */
export const TIE_AS_EMPATE = true

export interface ResolveOutcomeOptions {
  /** Valor da stake, base do PnL. Default 1. */
  stake?: number
  /** Tamanho de 1 tick do ativo (`AssetDef.tickSize`). Default 0 (sem tolerância). */
  tickSize?: number
  /** Nº de ticks de tolerância. Default `DEFAULT_TIE_TOLERANCE`. */
  toleranceTicks?: number
  /** Override da feature flag `TIE_AS_EMPATE`. */
  tieAsEmpate?: boolean
}

export interface ResolvedOutcome {
  result: TradeOutcome
  pnl: number
}

/**
 * Classifica uma operação binária e calcula o PnL.
 *
 * Se `|exit - entry| <= tickSize * toleranceTicks`, devolve `EMPATE` com PnL 0
 * (devolução da stake). Caso contrário, aplica a regra direcional atual.
 */
export function resolveOutcome(
  entry: number,
  exit: number,
  direction: CandleDirection,
  payout: number,
  options: ResolveOutcomeOptions = {},
): ResolvedOutcome {
  const tieAsEmpate = options.tieAsEmpate ?? TIE_AS_EMPATE
  const tolerance =
    Math.max(0, options.tickSize ?? 0) *
    Math.max(0, options.toleranceTicks ?? DEFAULT_TIE_TOLERANCE)

  if (
    exit === entry ||
    (tieAsEmpate && tolerance > 0 && Math.abs(exit - entry) <= tolerance)
  ) {
    return { result: 'TIE', pnl: 0 }
  }

  const stake = options.stake ?? 1
  const result: TradeOutcome = (direction === 'UP') === (exit > entry) ? 'WIN' : 'LOSS'
  return { result, pnl: result === 'WIN' ? stake * payout : -stake }
}
