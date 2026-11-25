import type { BucketStats, TradeResult } from './types.js'

/**
 * Limite inferior do intervalo de Wilson para uma proporcao.
 * Usado para nao confiar em 8/10 = 80% de acerto com amostra ridicula.
 */
export function wilsonLower(successes: number, n: number, z = 1.96): number {
  if (n <= 0) return 0
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.max(0, (center - margin) / denom)
}

/** Taxa de acerto minima para empatar, dado o payoff (payout de expiracao fixa). */
export function breakevenWinRate(payoutRatio: number): number {
  if (payoutRatio <= 0) return 1
  return 1 / (1 + payoutRatio)
}

/** Taxa de acerto minima para empatar, dado o R:R alvo (modo com stop e alvo). */
export function breakevenFromRewardRisk(rewardRisk: number): number {
  if (rewardRisk <= 0) return 1
  return 1 / (1 + rewardRisk)
}

interface Acc {
  n: number
  wins: number
  expiryWins: number
  expiryLosses: number
  expiryDraws: number
  sumWinR: number
  sumLossR: number
  sumR: number
  sumExpiryEv: number
}

const empty = (): Acc => ({
  n: 0,
  wins: 0,
  expiryWins: 0,
  expiryLosses: 0,
  expiryDraws: 0,
  sumWinR: 0,
  sumLossR: 0,
  sumR: 0,
  sumExpiryEv: 0,
})

/**
 * Livro de edge incremental: acumula resultados por bucket e por modulo,
 * com custo O(1) por trade. E a fonte de verdade do gate.
 */
export class EdgeBook {
  private buckets = new Map<string, Acc>()
  private modules = new Map<string, Acc>()

  add(trade: TradeResult): void {
    const apply = (acc: Acc) => {
      acc.n++
      if (trade.expiryOutcome === 'win' || trade.expiryWin) acc.expiryWins++
      else if (trade.expiryOutcome === 'loss') acc.expiryLosses++
      else if (trade.expiryOutcome === 'draw') acc.expiryDraws++
      acc.sumExpiryEv += trade.evPerStake ?? 0
      acc.sumR += trade.rMultiple
      if (trade.rMultiple > 0) {
        acc.wins++
        acc.sumWinR += trade.rMultiple
      } else {
        acc.sumLossR += trade.rMultiple
      }
    }
    const bKey = trade.bucket
    if (!this.buckets.has(bKey)) this.buckets.set(bKey, empty())
    apply(this.buckets.get(bKey)!)
    const mKey = trade.moduleId
    if (!this.modules.has(mKey)) this.modules.set(mKey, empty())
    apply(this.modules.get(mKey)!)
  }

  addAll(trades: TradeResult[]): void {
    for (const t of trades) this.add(t)
  }

  clone(): EdgeBook {
    const copy = new EdgeBook()
    for (const [k, v] of this.buckets) copy.buckets.set(k, { ...v })
    for (const [k, v] of this.modules) copy.modules.set(k, { ...v })
    return copy
  }

  get(bucket: string): BucketStats | null {
    const acc = this.buckets.get(bucket)
    return acc ? toStats(bucket, acc) : null
  }

  getModule(moduleId: string): BucketStats | null {
    const acc = this.modules.get(moduleId)
    return acc ? toStats(moduleId, acc) : null
  }

  /** bucket especifico; se raso demais, cai para o agregado do modulo. */
  resolve(
    bucket: string,
    moduleId: string,
    minTrades: number,
    sample: 'all' | 'resolved' = 'all',
  ): BucketStats | null {
    const sampleSize = (stats: BucketStats) =>
      sample === 'resolved' ? stats.expiryResolvedTrades : stats.n
    const b = this.get(bucket)
    if (b && sampleSize(b) >= minTrades) return b
    const m = this.getModule(moduleId)
    if (m && sampleSize(m) >= minTrades) return m
    return b ?? m
  }

  all(): BucketStats[] {
    return [...this.buckets.entries()].map(([k, v]) => toStats(k, v)).sort((a, b) => b.n - a.n)
  }
}

function toStats(key: string, acc: Acc): BucketStats {
  const losses = acc.n - acc.wins
  const winRate = acc.n > 0 ? acc.wins / acc.n : 0
  const expiryWinRate = acc.n > 0 ? acc.expiryWins / acc.n : 0
  const expiryResolvedTrades = acc.expiryWins + acc.expiryLosses
  const expiryResolvedWinRate =
    expiryResolvedTrades > 0 ? acc.expiryWins / expiryResolvedTrades : 0
  const avgWinR = acc.wins > 0 ? acc.sumWinR / acc.wins : 0
  const avgLossR = losses > 0 ? Math.abs(acc.sumLossR / losses) : 0
  const profitFactor = acc.sumLossR !== 0 ? acc.sumWinR / Math.abs(acc.sumLossR) : acc.sumWinR > 0 ? Infinity : 0
  return {
    bucket: key,
    n: acc.n,
    wins: acc.wins,
    winRate,
    winRateLower: wilsonLower(acc.wins, acc.n),
    expiryWins: acc.expiryWins,
    expiryLosses: acc.expiryLosses,
    expiryDraws: acc.expiryDraws,
    expiryWinRate,
    expiryWinRateLower: wilsonLower(acc.expiryWins, acc.n),
    expiryResolvedTrades,
    expiryResolvedWinRate,
    expiryResolvedWinRateLower: wilsonLower(acc.expiryWins, expiryResolvedTrades),
    evPerStake: acc.n > 0 ? acc.sumExpiryEv / acc.n : 0,
    avgWinR,
    avgLossR,
    expectancyR: acc.n > 0 ? acc.sumR / acc.n : 0,
    profitFactor,
    breakeven: avgWinR + avgLossR > 0 ? avgLossR / (avgWinR + avgLossR) : 0.5,
  }
}
