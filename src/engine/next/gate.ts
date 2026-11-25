import { moduleAllowedInRegime } from './modules.js'
import { breakevenFromRewardRisk, breakevenWinRate } from './stats.js'
import type { EdgeBook } from './stats.js'
import type { EngineConfig, GateDecision, MarketContext, SetupCandidate } from './types.js'

export interface RuntimeState {
  day: string
  signalsToday: number
  consecutiveLosses: number
  cooldownUntilIndex: number
  pausedUntilMinute: number
}

export function freshState(day: string): RuntimeState {
  return { day, signalsToday: 0, consecutiveLosses: 0, cooldownUntilIndex: -1, pausedUntilMinute: -1 }
}

export function rewardRiskOf(candidate: SetupCandidate): number {
  const risk = Math.abs(candidate.reference - candidate.stop)
  const reward = Math.abs(candidate.target - candidate.reference)
  if (risk <= 0) return 0
  return reward / risk
}

/**
 * O gate e a parte que o bot atual nao tinha: `edgeGate.ts` calculava
 * estatistica mas nao barrava nada. Aqui ele BARRA.
 *
 * Dois modos:
 *  - 'r'      : exige limite inferior de acerto acima do breakeven de payoff/R:R,
 *               expectancia em R positiva e risco maior que 4x o custo.
 *  - 'expiry' : exige limite inferior de ACERTO NA EXPIRACAO acima de 1/(1+payout)
 *               mais a margem, e EV por stake positivo. Nao existe R:R nem stop.
 */
export function evaluateGate(
  candidate: SetupCandidate,
  ctx: MarketContext,
  book: EdgeBook,
  cfg: EngineConfig,
  state: RuntimeState,
): GateDecision {
  const mode = cfg.mode ?? 'r'
  const useResolvedExpirySample =
    mode === 'expiry' && (cfg.expiryDrawPolicy ?? 'refund') === 'refund'
  const reasons: string[] = []
  const stats = book.resolve(
    candidate.bucket,
    candidate.moduleId,
    cfg.minTradesPerBucket,
    useResolvedExpirySample ? 'resolved' : 'all',
  )
  const rr = rewardRiskOf(candidate)
  const breakeven = mode === 'expiry' ? breakevenWinRate(cfg.payoutRatio) : Math.max(breakevenWinRate(cfg.payoutRatio), breakevenFromRewardRisk(rr))
  const risk = Math.abs(candidate.reference - candidate.stop)
  const costInR = risk > 0 ? cfg.costPerTrade / risk : Infinity

  const probability = !stats
    ? 0
    : mode === 'expiry'
      ? useResolvedExpirySample
        ? stats.expiryResolvedWinRate
        : stats.expiryWinRate
      : stats.winRate
  const lowerWinRate = !stats
    ? 0
    : mode === 'expiry'
      ? useResolvedExpirySample
        ? stats.expiryResolvedWinRateLower
        : stats.expiryWinRateLower
      : stats.winRateLower
  const sampleSize = !stats
    ? 0
    : useResolvedExpirySample
      ? stats.expiryResolvedTrades
      : stats.n
  const expectancy = !stats ? 0 : mode === 'expiry' ? stats.evPerStake : stats.expectancyR
  const evPerStake = mode === 'expiry' ? expectancy : 0

  const fail = (msg: string): GateDecision => ({
    allowed: false,
    reasons: [...reasons, msg],
    probability,
    expectancyR: expectancy,
    evPerStake,
    sampleSize,
    breakeven,
  })

  if (!moduleAllowedInRegime(candidate.moduleId, ctx.regime)) {
    return fail(`modulo ${candidate.moduleId} nao opera em regime ${ctx.regime}`)
  }
  if (ctx.phase === 'pre' || ctx.phase === 'post') return fail('fora da sessao')
  if (ctx.minutesFromOpen < cfg.session.noEntryAfterOpenMinutes) {
    return fail(`primeiros ${cfg.session.noEntryAfterOpenMinutes} min: liquidez e volatilidade instaveis`)
  }
  if (ctx.minutesFromOpen > cfg.session.closeMinute - cfg.session.openMinute - cfg.session.noEntryBeforeCloseMinutes) {
    return fail(`ultimos ${cfg.session.noEntryBeforeCloseMinutes} min: sem entrada`)
  }
  if (state.signalsToday >= cfg.maxSignalsPerDay) return fail('limite diario de sinais atingido')
  if (ctx.index < state.cooldownUntilIndex) return fail('cooldown apos perda')
  if (ctx.minutesFromOpen < state.pausedUntilMinute) return fail('pausa apos sequencia de perdas')
  if (mode !== 'expiry' && !(risk > 0)) return fail('stop invalido')

  if (!stats || stats.n < cfg.minTradesPerBucket) {
    return fail(
      `amostra insuficiente: ${sampleSize} trades validos (minimo ${cfg.minTradesPerBucket}) - coletando dados`,
    )
  }

  if (mode === 'expiry') {
    if (sampleSize < cfg.minTradesPerBucket) {
      return fail(
        `amostra insuficiente: ${sampleSize} resultados sem empate (minimo ${cfg.minTradesPerBucket}) - coletando dados`,
      )
    }
    if (lowerWinRate < breakeven + cfg.edgeMargin) {
      return fail(
        `acerto na expiracao ${(probability * 100).toFixed(1)}% com piso ${(lowerWinRate * 100).toFixed(1)}% abaixo do breakeven ${(breakeven * 100).toFixed(1)}% + margem ${(cfg.edgeMargin * 100).toFixed(1)}pp`,
      )
    }
    if (expectancy <= 0) return fail(`EV por stake ${expectancy.toFixed(4)} nao positivo`)
    reasons.push(
      `bucket ${stats.bucket}: n=${sampleSize}, acerto na expiracao ${(probability * 100).toFixed(1)}% (piso ${(lowerWinRate * 100).toFixed(1)}%)`,
      `breakeven ${(breakeven * 100).toFixed(1)}% (payout ${(cfg.payoutRatio * 100).toFixed(0)}%), EV ${(expectancy * 100).toFixed(2)}% por stake`,
    )
    return {
      allowed: true,
      reasons,
      probability,
      expectancyR: expectancy,
      evPerStake,
      sampleSize: stats.n,
      breakeven,
    }
  }

  if (risk < 4 * cfg.costPerTrade) {
    return fail(
      `risco ${risk.toFixed(4)} menor que 4x o custo round-trip (${cfg.costPerTrade}): o spread come o edge`,
    )
  }
  if (rr < 1.2) return fail(`R:R ${rr.toFixed(2)} abaixo de 1.2`)
  if (lowerWinRate < breakeven + cfg.edgeMargin) {
    return fail(
      `limite inferior de acerto ${(lowerWinRate * 100).toFixed(1)}% abaixo do breakeven ${(breakeven * 100).toFixed(1)}% + margem ${(cfg.edgeMargin * 100).toFixed(1)}pp`,
    )
  }
  if (stats.expectancyR <= 0) return fail(`expectancia medida ${stats.expectancyR.toFixed(3)}R nao positiva`)
  if (stats.expectancyR < 2 * costInR) {
    return fail(
      `expectancia ${stats.expectancyR.toFixed(3)}R nao cobre 2x o custo (${(2 * costInR).toFixed(3)}R)`,
    )
  }

  reasons.push(
    `bucket ${stats.bucket}: n=${stats.n}, acerto ${(stats.winRate * 100).toFixed(1)}% (piso ${(stats.winRateLower * 100).toFixed(1)}%)`,
    `expectancia ${stats.expectancyR.toFixed(3)}R, breakeven ${(breakeven * 100).toFixed(1)}%`,
    `R:R ${rr.toFixed(2)}, custo ${costInR.toFixed(3)}R`,
  )

  return {
    allowed: true,
    reasons,
    probability,
    expectancyR: stats.expectancyR,
    evPerStake: 0,
    sampleSize: stats.n,
    breakeven,
  }
}
